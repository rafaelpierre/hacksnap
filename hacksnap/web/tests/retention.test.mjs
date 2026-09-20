import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

const sql = readFileSync(process.env.HACKSNAP_SCHEMA_SQL, 'utf8');
const split = sql.indexOf('-- Running upgrade 0007_rank_history -> 0008_disposable_contents');
assert.ok(split > 0);
const run = '00000000-0000-0000-0000-000000000001';
const payload = {story:{id:1,title:'AI',url:'https://example.com',score:10},comments:[
  {depth:1,item:{id:10,parent:1,text:'First',by:'a'}},
  {depth:2,item:{id:11,parent:10,text:'Reply',by:'b'}},
]};
// Execute the actual collector statements against PostgreSQL, with driver-style binds.
const storage = readFileSync(new URL('../../../data/src/hn_trending/storage.py', import.meta.url), 'utf8');
async function collector(db, name, params) {
  const query = storage.match(new RegExp(`${name} = """([\\s\\S]*?)"""`))[1];
  const keys = [];
  const bound = query.replace(/%\((\w+)\)s/g, (_, key) => {
    if (!keys.includes(key)) keys.push(key);
    return `$${keys.indexOf(key)+1}`;
  });
  return db.query(bound, keys.map(k => params[k]));
}
async function ingest(db, data=payload) {
  const params = {hn_id:1,title:'AI',url:'https://example.com',full_raw_text_contents:JSON.stringify(data),
    date_published:new Date().toISOString(),date_added:new Date().toISOString(),author:'a',points:10,
    comment_count:2,last_seen_run_id:run};
  await db.exec('BEGIN');
  try {
    for (const name of ['UPSERT_THREAD','UPSERT_CONTENTS','DISCARD_REDUNDANT_CONTENTS']) await collector(db,name,params);
    await collector(db,'INSERT_SNAPSHOT', {...params,run_id:run,raw_payload:JSON.stringify(data),content_hash:'a'.repeat(64),
      score:10,descendants:2,top_story_rank:1,max_comment_depth:5});
    await db.exec('COMMIT');
  } catch(e) {await db.exec('ROLLBACK'); throw e;}
}
async function summary(db, id=1) {
  const repository = readFileSync(new URL('../../pipeline/supabase.py', import.meta.url), 'utf8');
  const query = repository.match(/(INSERT INTO hacksnap_summaries[\s\S]*?)"""/)[1];
  const contentHash = (await db.query('SELECT content_hash FROM hn_thread_contents WHERE hn_id=$1',[id])).rows[0]?.content_hash;
  const params = {story_id:id,article_url:'https://example.com',article_summary:'Article',article_key_points:'[]',
    discussion_summary:'Discussion',discussion_points:'[]',overall_takeaway:'Takeaway',model:'test',
    prompt_version:'v1',source_fingerprint:'b'.repeat(64),source_coverage:'{}',content_hash:contentHash};
  const keys=[];
  const bound=query.replace(/%\((\w+)\)s/g,(_,key)=>{keys.push(key);return `$${keys.length}`;});
  await db.query(bound,keys.map(k=>params[k]));
  const failure = repository.match(/(INSERT INTO hacksnap_fetch_failures[\s\S]*?)"""/)[1];
  let i=0;
  await db.query(failure.replace(/%s/g,()=>`$${++i}`),[id,'different-url']);
  i=0;
  await db.query(failure.replace(/%s/g,()=>`$${++i}`),[id,'different-url']);
}
async function count(db, table) {return Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);}

test('populated migration preserves metadata, identities, payloads, views and summaries; cleanup is independent', async () => {
 const db = new PGlite();
 try {
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated;');
  await db.exec(sql.slice(0,split)+'COMMIT;');
  await db.query(`INSERT INTO hn_ingestion_runs(run_id,status,filters,finished_at) VALUES ($1,'succeeded','{"classify_topic":true}',now())`,[run]);
  await db.query(`INSERT INTO hacker_news_threads(hn_id,title,url,full_raw_text_contents,date_published,last_seen_run_id,points,comment_count)
    VALUES (1,'AI','https://example.com',$1,now(),$2,10,2)`,[JSON.stringify(payload),run]);
  await db.query(`INSERT INTO hacksnap_summaries(story_id,article_summary,article_key_points,
    discussion_summary,discussion_points,overall_takeaway,model,prompt_version,source_fingerprint,source_coverage)
    VALUES (1,'Legacy article','[]','Discussion','[]','Takeaway','test','v1',$1,'{}')`,['b'.repeat(64)]);
  await db.query(`INSERT INTO hn_thread_snapshots(run_id,hn_id,raw_payload,content_hash,score,descendants,top_story_rank,max_comment_depth)
    VALUES ($1,1,$2,$3,10,2,1,5)`,[run,JSON.stringify(payload),'a'.repeat(64)]);
  await db.exec('GRANT SELECT ON hacksnap_ranked_stories TO authenticated');
  await db.exec('BEGIN;'+sql.slice(split));
  assert.equal(await count(db,'hn_items'),1);
  assert.equal((await db.query('SELECT article_summary, summarized_content_hash FROM hacksnap_summaries')).rows[0].article_summary,'Legacy article');
  assert.equal((await db.query('SELECT summarized_content_hash FROM hacksnap_summaries')).rows[0].summarized_content_hash,null);

  assert.equal(JSON.parse((await db.query('SELECT full_raw_text_contents FROM hn_thread_contents')).rows[0].full_raw_text_contents).comments.length,2);
  assert.equal(await count(db,'hacksnap_current_stories'),1);
  assert.equal((await db.query("SELECT has_table_privilege('authenticated','hacksnap_ranked_stories','SELECT') AS granted")).rows[0].granted,true);
  await ingest(db);
  await summary(db);
  await db.exec("INSERT INTO hacksnap_rank_history(hn_id,rank) VALUES (1,1)");
  await db.exec(`INSERT INTO hn_thread_summaries(snapshot_id,model,prompt_version,status,summary)
    SELECT snapshot_id,'legacy','v1','succeeded','keep' FROM hn_thread_snapshots`);
  const result=(await db.query('SELECT * FROM cleanup_hn_contents()')).rows[0];
  assert.equal(Number(result.contents_deleted),1);
  assert.equal(Number(result.snapshots_cleared),1);
  for(const table of ['hn_items','hacker_news_threads','hacksnap_summaries','hn_thread_snapshots','hn_thread_summaries','hacksnap_rank_history','hacksnap_fetch_failures','hacksnap_current_stories']) assert.equal(await count(db,table),1,table);
  await ingest(db);
  assert.equal(await count(db,'hn_thread_contents'),0,'unchanged content stays purged');
  const changed=structuredClone(payload); changed.comments[0].item.text='Edited';
  await ingest(db,changed);
  await db.query('SELECT * FROM cleanup_hn_contents()');
  assert.equal(await count(db,'hn_thread_contents'),1,'unsummarized changes survive cleanup');
  // Source reverts before a summary is generated: remove the obsolete pending payload.
  await ingest(db);
  assert.equal(await count(db,'hn_thread_contents'),0);
  await ingest(db,changed);
  await db.exec("UPDATE hacker_news_threads SET date_added=now()-interval '8 days'");
  await db.query('SELECT * FROM cleanup_hn_contents()');
  await ingest(db,changed);
  assert.equal(await count(db,'hn_thread_contents'),0,'expired content is not recreated');
  await db.exec('DELETE FROM hacker_news_threads WHERE hn_id=1');
  for(const table of ['hn_items','hacksnap_summaries','hn_thread_snapshots','hacksnap_rank_history','hacksnap_fetch_failures']) assert.equal(await count(db,table),1,table);
  for(const role of ['anon','authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.query('SELECT * FROM hn_thread_contents'),/permission denied/);
    await assert.rejects(db.query('SELECT * FROM cleanup_hn_contents()'),/permission denied/);
    await db.exec('RESET ROLE');
  }
 } finally {await db.close();}
});

test('hash is insensitive to scores/order and sensitive to edits, deletion and structure',async()=>{
 const db=new PGlite();
 try {
  await db.exec(sql);
  const hash=async p=>(await db.query('SELECT hn_source_hash($1::jsonb) AS h',[JSON.stringify(p)])).rows[0].h;
  const original=await hash(payload);
  const reordered=structuredClone(payload); reordered.comments.reverse(); reordered.story.score=999;
  assert.equal(await hash(reordered),original);
  for(const [key,value] of [['text','edit'],['parent',999],['deleted',true]]) {
    const changed=structuredClone(payload); changed.comments[0].item[key]=value;
    assert.notEqual(await hash(changed),original);
  }
  await assert.rejects(db.query('SELECT * FROM cleanup_hn_contents(0)'),/batch_size/);
  // Fresh identity creation and optional payload ingestion on an empty migrated database.
  await db.query(`INSERT INTO hn_ingestion_runs(run_id,status) VALUES ($1,'succeeded')`,[run]);
  await ingest(db);
  assert.equal(await count(db,'hn_items'),1);
  assert.equal(await count(db,'hn_thread_contents'),1);
  await summary(db);
  await db.exec('UPDATE hacksnap_summaries SET article_summary=NULL');
  await ingest(db);
  await db.query('SELECT * FROM cleanup_hn_contents()');
  assert.equal(await count(db,'hn_thread_contents'),1,'discussion-only summary does not meet article retention rule');
  await db.exec('DELETE FROM hacksnap_summaries');
  await db.exec("UPDATE hacker_news_threads SET date_added=now()-interval '8 days'");
  await db.exec("INSERT INTO hn_items VALUES (2); INSERT INTO hn_thread_contents(hn_id,full_raw_text_contents,content_hash,fetched_at) VALUES (2,'{}','orphan',now()-interval '8 days')");
  let cleaned=(await db.query('SELECT * FROM cleanup_hn_contents(1)')).rows[0];
  assert.equal(Number(cleaned.contents_deleted),1,'batch limit is enforced');
  assert.equal(await count(db,'hn_thread_contents'),1);
  cleaned=(await db.query('SELECT * FROM cleanup_hn_contents(1)')).rows[0];
  assert.equal(Number(cleaned.contents_deleted),1,'old content without metadata is also removed');
  assert.equal(await count(db,'hn_thread_contents'),0);
  assert.equal(await count(db,'hn_items'),2);

 } finally {await db.close();}
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, after, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const older = "00000000-0000-0000-0000-000000000001";
const current = "00000000-0000-0000-0000-000000000002";
const failed = "00000000-0000-0000-0000-000000000003";
const running = "00000000-0000-0000-0000-000000000004";
const nonAI = "00000000-0000-0000-0000-000000000005";

before(async () => {
  assert.ok(process.env.HACKSNAP_SCHEMA_SQL, "Export Alembic SQL and set HACKSNAP_SCHEMA_SQL");
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  await db.exec(readFileSync(process.env.HACKSNAP_SCHEMA_SQL, "utf8"));
  for (const [id, status, age, ai] of [
    [older, "succeeded", 4, true], [current, "succeeded", 3, true],
    [failed, "failed", 2, true], [running, "running", 1, true], [nonAI, "succeeded", 0, false],
  ]) {
    await db.query(`INSERT INTO hn_ingestion_runs(run_id,status,started_at,finished_at,filters)
      VALUES ($1,$2,now() - $3 * interval '1 hour',now(),$4)`, [id,status,age,JSON.stringify({classify_topic:ai})]);
  }
  for (let id = 1; id <= 15; id++) {
    await db.query(`INSERT INTO hacker_news_threads
      (hn_id,title,url,full_raw_text_contents,date_published,date_added,points,comment_count,last_seen_run_id)
      VALUES ($1,'Example','https://example.com','{}',now() - interval '2 days',
        now() - interval '1 hour',$2,$3,$4)`, [id, id * 10, 100 - id, current]);
  }
  for (const [id, age, run] of [[20,25,current], [21,1,older], [22,1,failed], [23,1,running], [24,1,nonAI], [25,-1,current]]) {
    await db.query(`INSERT INTO hacker_news_threads
      (hn_id,title,url,full_raw_text_contents,date_published,date_added,points,comment_count,last_seen_run_id)
      VALUES ($1,'Excluded','https://example.com','{}',now(),now() - $2 * interval '1 hour',9999,999,$3)`, [id,age,run]);
  }
});

after(async () => db.close());

test("leaderboard prefers last 24h across successful AI runs, then sorts by points descending", async () => {
  const { rows } = await db.query("SELECT hn_id, points, rank FROM hacksnap_current_stories ORDER BY rank");
  assert.deepEqual(rows.map(r => Number(r.hn_id)), [21,15,14,13,12,11,10,9,8,7]);
  assert.deepEqual(rows.map(r => Number(r.rank)), [1,2,3,4,5,6,7,8,9,10]);
  // Publication was two days ago: eligibility is deliberately based on date_added.
});

test("ties are deterministic and use story ID, not comment count", async () => {
  await db.exec("UPDATE hacker_news_threads SET points = 150 WHERE hn_id = 14");
  const { rows } = await db.query("SELECT hn_id FROM hacksnap_current_stories ORDER BY rank LIMIT 3");
  assert.deepEqual(rows.map(r => Number(r.hn_id)), [21,15,14]);
});

test("unchanged snapshots do not remove a story whose membership was refreshed", async () => {
  // No snapshot is inserted for this story. The run marker is sufficient.
  await db.query("UPDATE hacker_news_threads SET last_seen_run_id=$1 WHERE hn_id=21", [current]);
  const { rows } = await db.query("SELECT hn_id FROM hacksnap_current_stories ORDER BY rank LIMIT 1");
  assert.equal(Number(rows[0].hn_id), 21);
});

test("enrichment is private and the shared view honors RLS", async () => {
  const { rows } = await db.query(`SELECT relname, relrowsecurity, reloptions FROM pg_class
    WHERE relname IN ('hacksnap_summaries','hacksnap_current_stories')`);
  assert.equal(rows.find(r => r.relname === "hacksnap_summaries").relrowsecurity, true);
  assert.ok(rows.find(r => r.relname === "hacksnap_current_stories").reloptions.includes("security_invoker=true"));
  await db.exec("SET ROLE anon");
  await assert.rejects(db.query("SELECT * FROM hacksnap_summaries"), /permission denied/);
  await assert.rejects(db.query("SELECT * FROM hacksnap_current_stories"), /permission denied/);
  await db.exec("RESET ROLE");
});

test("a previously eligible story remains visible while the next run is unfinished", async () => {
  await db.query(`INSERT INTO hn_thread_snapshots(run_id,hn_id,raw_payload,content_hash,
    score,descendants,top_story_rank,max_comment_depth) VALUES ($1,15,'{}',$2,150,85,1,5)`,
    [current, "a".repeat(64)]);
  await db.query("UPDATE hacker_news_threads SET last_seen_run_id=$1 WHERE hn_id=15", [running]);
  const { rows } = await db.query("SELECT hn_id FROM hacksnap_current_stories WHERE hn_id=15");
  assert.equal(rows.length, 1);
  await db.query("UPDATE hacker_news_threads SET last_seen_run_id=$1 WHERE hn_id=15", [current]);
});

test("a new successful run with no matches preserves the leaderboard", async () => {
  const before = await db.query("SELECT hn_id FROM hacksnap_current_stories ORDER BY rank");
  await db.query(`INSERT INTO hn_ingestion_runs(run_id,status,started_at,finished_at,filters)
    VALUES ('00000000-0000-0000-0000-000000000006','succeeded',now() + interval '1 minute',now(),'{"classify_topic":true}')`);
  const { rows } = await db.query("SELECT hn_id FROM hacksnap_current_stories ORDER BY rank");
  assert.deepEqual(rows, before.rows);
  assert.equal(rows.length, 10);
});

test("failed fetches leave the leaderboard and the next story fills the slot", async () => {
  await db.query("INSERT INTO hacksnap_fetch_failures(story_id,article_url) VALUES (21,'https://example.com')");
  let result = await db.query("SELECT hn_id FROM hacksnap_current_stories ORDER BY rank");
  assert.deepEqual(result.rows.map(r => Number(r.hn_id)), [15,14,13,12,11,10,9,8,7,6]);
  // Another ingestion update does not clear the failure.
  await db.query("UPDATE hacker_news_threads SET points=10000 WHERE hn_id=21");
  result = await db.query("SELECT hn_id FROM hacksnap_current_stories WHERE hn_id=21");
  assert.equal(result.rows.length, 0);
  await db.query("UPDATE hacker_news_threads SET url='https://example.com/corrected' WHERE hn_id=21");
  result = await db.query("SELECT hn_id FROM hacksnap_current_stories WHERE hn_id=21");
  assert.equal(result.rows.length, 1);
  await db.exec("DELETE FROM hacksnap_fetch_failures; UPDATE hacker_news_threads SET url='https://example.com', points=9999 WHERE hn_id=21");
});

test("fetch failure records are private and protected by RLS", async () => {
  const { rows } = await db.query("SELECT relrowsecurity FROM pg_class WHERE relname='hacksnap_fetch_failures'");
  assert.equal(rows[0].relrowsecurity, true);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.query("SELECT * FROM hacksnap_fetch_failures"), /permission denied/);
    await assert.rejects(db.query("INSERT INTO hacksnap_fetch_failures(story_id,article_url) VALUES (21,'x')"), /permission denied/);
    await db.exec("RESET ROLE");
  }
});

test("older stories fill gaps without outranking recent stories in the displayed ranking", async () => {
  await db.exec("UPDATE hacker_news_threads SET date_added = now() - interval '2 days' WHERE hn_id BETWEEN 1 AND 12");
  const { rows } = await db.query("SELECT hn_id, is_recent, points FROM hacksnap_current_stories ORDER BY rank");
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.filter(r => r.is_recent).map(r => Number(r.hn_id)), [21,15,14,13]);
  assert.ok(rows.some(r => Number(r.hn_id) === 20));
  assert.deepEqual(rows.map(r => Number(r.hn_id)), [21,15,14,13,20,12,11,10,9,8]);
  assert.ok(rows[4].points > rows[3].points, "higher archive points must not override recency");
  const ranked = await db.query("SELECT rank FROM hacksnap_current_stories ORDER BY rank");
  assert.deepEqual(ranked.rows.map(r => Number(r.rank)), [1,2,3,4,5,6,7,8,9,10]);
});

test("an entirely quiet 24h still has ten archive stories", async () => {
  await db.exec("UPDATE hacker_news_threads SET date_added = now() - interval '3 days'");
  const { rows } = await db.query("SELECT hn_id, is_recent FROM hacksnap_current_stories ORDER BY rank");
  assert.equal(rows.length, 10);
  assert.ok(rows.every(r => !r.is_recent));
  assert.deepEqual(rows.map(r => Number(r.hn_id)), [25,21,20,15,14,13,12,11,10,9]);
});

test("fewer than ten eligible stories returns everything available", async () => {
  await db.exec("DELETE FROM hn_thread_snapshots");
  await db.exec("DELETE FROM hacker_news_threads WHERE hn_id > 3");
  const { rows } = await db.query("SELECT hn_id FROM hacksnap_current_stories ORDER BY rank");
  assert.equal(rows.length, 3);
});

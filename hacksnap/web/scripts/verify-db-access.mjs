// Run with HACKSNAP_WEB_DATABASE_URL set. Never prints credentials or row contents.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {archiveMonthsSQL, archiveQuery} from '../lib/archive.ts';
import {rankHistorySQL} from '../lib/rank-history.ts';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = new URL(process.env.HACKSNAP_WEB_DATABASE_URL);
url.searchParams.set('sslmode', 'verify-full');
url.searchParams.set('sslrootcert', path.join(root, 'certs/supabase-ca.crt'));
const client = new pg.Client({connectionString:url.toString(), connectionTimeoutMillis:10000});
try {
  await client.connect();
  const {rows:[role]} = await client.query(`SELECT current_user, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
    FROM pg_roles WHERE rolname=current_user`);
  assert.equal(role.current_user, 'hacksnap_reader');
  for (const field of ['rolsuper','rolbypassrls','rolcreatedb','rolcreaterole']) assert.equal(role[field],false);
  const source = readFileSync(path.join(root,'lib/data.ts'),'utf8');
  const fields = source.match(/const fields = `([\s\S]*?)`;/)[1];
  let checked = 0;
  for (const match of source.matchAll(/client\.query[^\n]*\(`([\s\S]*?)`/g)) {
    const query = match[1].replaceAll('${fields}',fields).replaceAll('${rankHistorySQL}',rankHistorySQL);
    const result = await client.query(query, query.includes('$1') ? [1] : []);
    if (query.includes('AS stories')) assert.ok(result.rows[0].stories.length > 0);
    checked++;
  }
  assert.equal(checked,4, 'Verify every inline website query');
  await client.query(archiveMonthsSQL);
  await client.query(archiveQuery(fields,null,1));
  await client.query(archiveQuery(fields,'2026-09',1));
  for (const query of [
    "UPDATE hacker_news_threads SET title='forbidden' WHERE false",
    'DELETE FROM hacksnap_summaries WHERE false',
    'INSERT INTO hacksnap_rank_history(hn_id,rank) SELECT 1,1 WHERE false',
    'SELECT * FROM hn_thread_contents LIMIT 0',
    'SELECT raw_payload FROM hn_thread_snapshots LIMIT 0',
    'SELECT source_fingerprint FROM hacksnap_summaries LIMIT 0',
    'SELECT * FROM hn_ingestion_runs LIMIT 0',
  ]) {
    let denied=false;
    try { await client.query(query); } catch(error) { if(error.code==='42501') denied=true; else throw error; }
    assert.ok(denied,'Expected database permission denial');
  }
  console.log('PASS: restricted login; all website queries; writes and private payload access denied.');
} catch(error) {
  console.error('Database access verification failed:', error.code ?? error.name);
  process.exitCode=1;
} finally { await client.end(); }

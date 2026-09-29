"""Exercise the image date window through the repository's PostgreSQL SQL."""

import json
import os
import subprocess

import pytest
from test_image_lifecycle import migration_sql, query_templates


@pytest.mark.skipif(not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"), reason="optional PGlite runtime")
def test_london_day_bounds_cover_scans_forced_queue_and_all_claim_mutations():
    script = r'''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const input = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();
const start = '2026-09-28T23:00:00+00:00';
const end = '2026-09-29T23:00:00+00:00';
async function execute(name, overrides={}) {
  let result;
  for (const query of input.queries[name]) {
    const params = query.keys.map((key, index) =>
      Object.hasOwn(overrides, key) ? overrides[key] : query.params[index]);
    result = await db.query(query.sql, params);
  }
  return result;
}
async function row(id) {
  return (await db.query('SELECT * FROM hacker_news_threads WHERE hn_id=$1', [id])).rows[0];
}
try {
  await db.exec(`CREATE ROLE hacksnap_reader;
    CREATE TABLE hacker_news_threads (hn_id bigint PRIMARY KEY, title text, url text,
      category text, date_added timestamptz NOT NULL);
    CREATE TABLE hacksnap_summaries (story_id bigint PRIMARY KEY, overall_takeaway text);
    CREATE VIEW hacksnap_ranked_stories AS SELECT hn_id FROM hacker_news_threads;
    INSERT INTO hacker_news_threads(hn_id,title,url,category,date_added) VALUES
      (1,'Older ready','https://publisher.test/1','ai','2026-09-28T22:59:59+00'),
      (2,'Exact start','https://publisher.test/2','ai','2026-09-28T23:00:00+00'),
      (3,'Last second','https://publisher.test/3','ai','2026-09-29T22:59:59+00'),
      (4,'Exact end','https://publisher.test/4','ai','2026-09-29T23:00:00+00'),
      (5,'Future','https://publisher.test/5','ai','2026-09-30T00:00:00+00'),
      (6,'Older lease','https://publisher.test/6','ai','2026-09-28T22:59:59+00'),
      (7,'Day lease','https://publisher.test/7','ai','2026-09-28T23:00:00+00'),
      (8,'End lease','https://publisher.test/8','ai','2026-09-29T23:00:00+00'),
      (9,'Older exhausted','https://publisher.test/9','ai','2026-09-28T22:59:59+00'),
      (10,'Day exhausted','https://publisher.test/10','ai','2026-09-28T23:00:00+00'),
      (11,'End exhausted','https://publisher.test/11','ai','2026-09-29T23:00:00+00');
    INSERT INTO hacksnap_summaries SELECT hn_id,'published' FROM hacker_news_threads;`);
  await db.exec(input.migration);
  await db.exec(`UPDATE hacker_news_threads SET image_status='ready',
    image_url='https://store.public.blob.vercel-storage.com/articles/1.png',
    image_source_type='og',image_width=800,image_height=400,image_mime_type='image/png'
    WHERE hn_id=1;
    UPDATE hacker_news_threads SET image_status='pending',image_attempt_token=
      ('00000000-0000-4000-8000-' || lpad(hn_id::text,12,'0'))::uuid,
      image_attempt_count=CASE WHEN hn_id IN (9,10,11) THEN 3 ELSE 1 END,
      image_attempted_at=now()-interval '2 hours'
    WHERE hn_id IN (6,7,8,9,10,11);`);
  const candidates = (await execute('list', {added_from:start, added_before:end})).rows
    .map(r=>Number(r.story_id));
  assert.deepEqual(candidates, [2,3,7,10]);
  assert.equal((await row(7)).image_queue_managed, false, 'candidate scan is read-only');
  await execute('day_legacy_candidates');
  assert.equal((await row(10)).image_status, 'failed');
  assert.equal((await row(9)).image_status, 'pending');
  assert.equal((await row(11)).image_status, 'pending');
  for (const id of [1,4,5]) {
    assert.equal((await execute('day_enqueue', {story_id:id,
      article_url:`https://publisher.test/${id}`})).affectedRows, 0,
      'force must not escape the date window');
  }
  assert.equal((await row(1)).image_status, 'ready');
  for (const id of [2,3]) {
    assert.equal((await execute('day_enqueue', {story_id:id,
      article_url:`https://publisher.test/${id}`})).affectedRows, 1);
  }
  await db.exec(`UPDATE hacker_news_threads SET image_attempts=3 WHERE hn_id=2;
    UPDATE hacker_news_threads SET image_queue_managed=true,image_status='pending',
      image_queued_at=now(),image_requested_url=url,image_attempts=3
    WHERE hn_id IN (4,5);`);
  const widened = (await execute('list', {added_from:start, added_before:end,
    include_failed:true, reprocess_ready:true})).rows.map(r=>Number(r.story_id));
  assert.ok(!widened.includes(4), 'exact upper bound stays excluded with retry and replacement flags');
  assert.ok(!widened.includes(1), 'older ready image stays excluded with replacement flag');
  assert.deepEqual((await execute('day_claim_one')).rows.map(r=>Number(r.story_id)), [7]);
  assert.equal((await row(2)).image_status, 'pending', 'story filter protects other terminal rows');
  assert.equal((await row(6)).image_queue_managed, false);
  assert.equal((await row(8)).image_queue_managed, false);
  assert.deepEqual((await execute('day_claim_all')).rows.map(r=>Number(r.story_id)), [3]);
  assert.equal((await row(2)).image_status, 'failed', 'in-window terminal row is settled');
  for (const id of [4,5,6,8,9,11]) {
    const current = await row(id);
    assert.equal(current.image_queue_managed, id===4 || id===5,
      `out-of-window row ${id} keeps ownership`);
    if (id===4 || id===5) {
      assert.equal(current.image_status, 'pending', `out-of-window queue ${id} is not finalized`);
      assert.equal(current.image_attempts, 3);
      assert.ok(current.image_queued_at);
    } else {
      assert.ok(current.image_attempt_token, `out-of-window legacy token ${id} is retained`);
    }
  }
} finally { await db.close(); }
'''
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script], capture_output=True, text=True,
        input=json.dumps({"migration": migration_sql(), "queries": query_templates()}, default=str),
        check=False,
    )
    assert result.returncode == 0, result.stderr[-2500:]

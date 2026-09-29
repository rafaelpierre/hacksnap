"""Execute the worker's actual claim/publish SQL against embedded PostgreSQL."""

import json
import os
import re
import subprocess
import sys
from io import StringIO
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from test_discussion_migration import load_migration


def query_templates():
    sys.path.insert(0, str(Path(__file__).parents[2] / "hacksnap"))
    from pipeline.supabase import Repository

    repository = Repository("unused")
    connection = MagicMock()
    connection.__enter__.return_value = connection
    repository._connect = lambda: connection
    result = {}

    def capture(name, method, *args, **kwargs):
        connection.execute.reset_mock()
        method(*args, **kwargs)
        result[name] = []
        for call in connection.execute.call_args_list:
            sql, params = call.args
            keys = []
            if isinstance(params, dict):
                def replace(match):
                    key = match.group(1)
                    if key not in keys:
                        keys.append(key)
                    return f"${keys.index(key) + 1}"
                sql = re.sub(r"%\((\w+)\)s", replace, sql)
                values = [params[key] for key in keys]
            else:
                values = list(params)
                for index in range(len(values)):
                    sql = sql.replace("%s", f"${index + 1}", 1)
                keys = [str(index) for index in range(len(values))]
            result[name].append({"sql": sql, "keys": keys, "params": values})

    capture("enqueue", repository.enqueue_image, 1, "https://publisher.test/1")
    capture("list", repository.list_image_candidates, limit=25)
    capture("claim", repository.claim_pending_images, limit=1, story_ids=[1])
    capture("ready", repository.mark_image_ready, 1, "00000000-0000-4000-8000-000000000001",
            "https://store.public.blob.vercel-storage.com/articles/1/hero-first.webp",
            "og", "https://publisher.test/photo.jpg", width=1200, height=630)
    capture("failed", repository.mark_image_failed, 1,
            "00000000-0000-4000-8000-000000000001", "blob_upload_failed")
    capture("legacy_claim", repository.claim_image_attempt, 1)
    return result


def migration_sql(name=None):
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output},
    )
    with Operations.context(context):
        for filename in ([name] if name else ["0015_article_images.py", "0016_image_queue.py"]):
            load_migration(filename).upgrade()
    return output.getvalue()


@pytest.mark.skipif(not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"), reason="optional PGlite runtime")
def test_image_jobs_recover_without_replacing_published_assets_or_stealing_claims():
    script = r'''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const input = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();
async function execute(name, overrides = {}) {
  let result;
  for (const query of input.queries[name]) {
    const params = query.keys.map((key, index) =>
      Object.hasOwn(overrides, key) ? overrides[key] : query.params[index]);
    result = await db.query(query.sql, params);
  }
  return result;
}
async function row(id = 1) {
  return (await db.query('SELECT * FROM hacker_news_threads WHERE hn_id=$1', [id])).rows[0];
}
try {
  await db.exec(`
    CREATE ROLE hacksnap_reader;
    CREATE TABLE hacker_news_threads (hn_id bigint PRIMARY KEY, title text, url text,
      category text, date_added timestamptz DEFAULT now());
    CREATE TABLE hacksnap_summaries (story_id bigint PRIMARY KEY, overall_takeaway text);
    CREATE VIEW hacksnap_ranked_stories AS SELECT hn_id FROM hacker_news_threads;
    INSERT INTO hacker_news_threads(hn_id,title,url,category) VALUES
      (1, 'First', 'https://publisher.test/1', 'ai'),
      (2, 'Second', 'https://publisher.test/2', 'ai'),
      (3, 'Self post', NULL, NULL), (4, 'No published summary', 'https://publisher.test/4', NULL);
    INSERT INTO hacksnap_summaries VALUES (1, 'A brief'), (2, 'Another brief'), (3, 'Discussion');
  `);
  await db.exec(input.migration);
  assert.equal((await execute('list')).rows.length, 3);
  assert.equal((await execute('enqueue', {story_id: 4, article_url: 'https://publisher.test/4'})).affectedRows, 0);
  assert.equal((await execute('enqueue')).affectedRows, 1);
  const first = (await execute('claim')).rows[0];
  assert.equal(first.attempts, 1);
  assert.equal((await execute('claim')).rows.length, 0, 'active lease must not be stolen');
  assert.equal((await execute('enqueue', {force: true})).affectedRows, 0);
  assert.equal((await execute('ready')).affectedRows, 0, 'wrong lease cannot publish');
  assert.equal((await execute('ready', {lease_token: first.lease_token})).affectedRows, 1);
  const original = (await row()).image_url;
  assert.equal((await row()).image_status, 'ready');
  assert.equal((await execute('enqueue')).affectedRows, 0, 'ordinary retry skips ready');
  assert.equal((await execute('list')).rows.length, 2);

  // Explicit replacement keeps the old image visible through failures and retries.
  assert.equal((await execute('enqueue', {reprocess_ready: true})).affectedRows, 1);
  assert.equal((await row()).image_url, original);
  const replacement = (await execute('claim')).rows[0];
  await execute('failed', {lease_token: replacement.lease_token});
  assert.equal((await row()).image_status, 'ready');
  assert.equal((await row()).image_url, original);
  assert.equal((await execute('claim')).rows.length, 0, 'backoff applies');
  await db.exec("UPDATE hacker_news_threads SET image_retry_after=now()-interval '1 second' WHERE hn_id=1");
  const retry = (await execute('claim')).rows[0];
  assert.equal(retry.attempts, 2);
  assert.equal((await execute('ready', {lease_token: replacement.lease_token})).affectedRows, 0);
  await execute('ready', {lease_token: retry.lease_token,
    image_url: 'https://store.public.blob.vercel-storage.com/articles/1/hero-second.webp'});
  assert.notEqual((await row()).image_url, original);

  // A failed replacement can be explicitly restarted without losing the ready image.
  await execute('enqueue', {reprocess_ready: true});
  const exhausted = (await execute('claim')).rows[0];
  await execute('failed', {lease_token: exhausted.lease_token});
  await db.exec('UPDATE hacker_news_threads SET image_attempts=3 WHERE hn_id=1');
  const retained = (await row()).image_url;
  assert.equal((await execute('enqueue', {reprocess_ready: true})).affectedRows, 1);
  assert.equal((await row()).image_attempts, 0);
  assert.equal((await row()).image_url, retained);
  const restarted = (await execute('claim')).rows[0];
  await execute('ready', {lease_token: restarted.lease_token, image_url: retained});

  // Self posts can receive generated artwork with null provenance.
  await execute('enqueue', {story_id: 3, article_url: null});
  const selfPost = (await execute('claim', {story_ids: [3]})).rows[0];
  assert.equal(selfPost.article_url, null);
  await execute('ready', {story_id: 3, lease_token: selfPost.lease_token,
    image_url: 'https://store.public.blob.vercel-storage.com/articles/3/hero-self.webp',
    source_type: 'generated', source_url: null});
  assert.equal((await row(3)).image_source_url, null);

  // Interrupted pending work can be reclaimed; its stale token cannot commit.
  await execute('enqueue', {story_id: 2, article_url: 'https://publisher.test/2'});
  const interrupted = (await execute('claim', {story_ids: [2]})).rows[0];
  await db.exec("UPDATE hacker_news_threads SET image_lease_expires_at=now()-interval '1 second' WHERE hn_id=2");
  const recovered = (await execute('claim', {story_ids: [2]})).rows[0];
  assert.notEqual(recovered.lease_token, interrupted.lease_token);
  assert.equal((await execute('ready', {story_id: 2, lease_token: interrupted.lease_token,
    image_url: 'https://store.public.blob.vercel-storage.com/articles/2/hero-stale.webp'})).affectedRows, 0);
  await execute('failed', {story_id: 2, lease_token: recovered.lease_token});
  await db.exec("UPDATE hacker_news_threads SET image_retry_after=now()-interval '1 second' WHERE hn_id=2");
  await execute('claim', {story_ids: [2]});
  await db.exec("UPDATE hacker_news_threads SET image_lease_expires_at=now()-interval '1 second' WHERE hn_id=2");
  assert.equal((await execute('list')).rows.length, 1, 'backfill can finalize an exhausted stale claim');
  assert.equal((await execute('claim', {story_ids: [2]})).rows.length, 0);
  assert.equal((await row(2)).image_status, 'failed', 'last crashed attempt becomes terminal');
  assert.equal((await execute('list')).rows.length, 0);
  assert.equal((await execute('list', {include_failed: true})).rows.length, 1);
  await execute('enqueue', {story_id: 2, article_url: 'https://publisher.test/2', force: true});
  assert.equal((await row(2)).image_attempts, 0);
  assert.equal((await execute('claim', {story_ids: [2]})).rows[0].attempts, 1);

  // Once a URL changes, expired work is requeued against the current URL.
  await db.exec("UPDATE hacker_news_threads SET url='https://publisher.test/changed', image_lease_expires_at=now()-interval '1 second' WHERE hn_id=2");
  await execute('enqueue', {story_id: 2, article_url: 'https://publisher.test/changed'});
  assert.equal((await execute('claim', {story_ids: [2]})).rows[0].article_url,
    'https://publisher.test/changed');

  assert.deepEqual((await db.query('SELECT overall_takeaway FROM hacksnap_summaries ORDER BY story_id')).rows,
    [{overall_takeaway: 'A brief'}, {overall_takeaway: 'Another brief'}, {overall_takeaway: 'Discussion'}]);
} finally { await db.close(); }
'''
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script], capture_output=True, text=True,
        input=json.dumps({"migration": migration_sql(), "queries": query_templates()}, default=str),
    )
    assert result.returncode == 0, result.stderr[-2500:]


@pytest.mark.skipif(not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"), reason="optional PGlite runtime")
def test_legacy_image_rows_upgrade_and_expired_work_moves_to_queue():
    script = r'''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const input = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();
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
      category text, date_added timestamptz DEFAULT now());
    CREATE TABLE hacksnap_summaries (story_id bigint PRIMARY KEY, overall_takeaway text);
    CREATE VIEW hacksnap_ranked_stories AS SELECT hn_id FROM hacker_news_threads;
    INSERT INTO hacker_news_threads(hn_id,title,url,category) VALUES
      (1,'Ready','https://publisher.test/1','ai'),
      (2,'Active','https://publisher.test/2','ai'),
      (3,'Expired','https://publisher.test/3','ai'),
      (4,'Exhausted','https://publisher.test/4','ai'),
      (5,'Failed','https://publisher.test/5','ai'),
      (6,'Replacement','https://publisher.test/6','ai'),
      (7,'Old exhausted failure','https://publisher.test/7','ai');
    INSERT INTO hacksnap_summaries VALUES
      (1,'Ready'),(2,'Active'),(3,'Expired'),(4,'Exhausted'),(5,'Failed'),
      (6,'Replacement'),(7,'Old exhausted failure');`);
  await db.exec(input.base);
  await db.exec(`UPDATE hacker_news_threads SET image_status='ready',
      image_url='https://store.public.blob.vercel-storage.com/articles/1.png',
      image_source_type='og',image_width=800,image_height=400,image_mime_type='image/png'
      WHERE hn_id=1;
    UPDATE hacker_news_threads SET image_status='pending',image_attempt_token='00000000-0000-4000-8000-000000000002',
      image_attempt_count=1,image_attempted_at=now() WHERE hn_id=2;
    UPDATE hacker_news_threads SET image_status='pending',image_attempt_token='00000000-0000-4000-8000-000000000003',
      image_attempt_count=2,image_attempted_at=now()-interval '2 hours' WHERE hn_id=3;
    UPDATE hacker_news_threads SET image_status='pending',image_attempt_token='00000000-0000-4000-8000-000000000004',
      image_attempt_count=3,image_attempted_at=now()-interval '2 hours' WHERE hn_id=4;
    UPDATE hacker_news_threads SET image_status='failed',image_attempt_count=1,
      image_attempted_at=now()-interval '2 hours',image_error='legacy failure' WHERE hn_id=5;
    UPDATE hacker_news_threads SET image_status='ready',
      image_url='https://store.public.blob.vercel-storage.com/articles/6.png',
      image_source_type='og',image_width=640,image_height=320,image_mime_type='image/png',
      image_attempt_token='00000000-0000-4000-8000-000000000006',
      image_attempt_count=2,image_attempted_at=now()-interval '2 hours' WHERE hn_id=6;
    UPDATE hacker_news_threads SET image_status='failed',image_attempt_count=3,
      image_attempted_at=now()-interval '2 hours',image_error='exhausted'
      WHERE hn_id=7;`);
  await db.exec(input.queue);
  assert.equal((await row(1)).image_width, 800);
  assert.equal((await row(1)).image_queue_managed, false);
  assert.equal((await row(2)).image_attempt_token, '00000000-0000-4000-8000-000000000002');
  assert.deepEqual((await execute('list')).rows.map(r=>Number(r.story_id)).sort(), [3,4,5,6]);
  assert.ok(!(await execute('list')).rows.some(r=>Number(r.story_id)===1),
    'existing ready asset is not backfilled by default');
  assert.ok((await execute('list', {include_failed:true})).rows.some(r=>Number(r.story_id)===7),
    'exhausted failure is only shown for explicit retry');
  assert.equal((await row(3)).image_queue_managed, false, 'dry-run scan must not write');
  assert.equal((await execute('claim', {story_ids:[2]})).rows.length, 0,
    'active legacy claim remains owned by the old worker');
  assert.equal((await row(2)).image_queue_managed, false);
  assert.equal((await row(3)).image_queue_managed, true);
  assert.equal((await row(3)).image_attempt_token, null);
  assert.equal((await row(4)).image_status, 'failed', 'exhausted legacy claim is terminal');
  assert.equal((await row(4)).image_attempts, 3);
  assert.equal((await row(7)).image_status, 'failed');
  assert.equal((await row(7)).image_queued_at, null);
  assert.equal((await execute('legacy_claim', {hn_id:3})).affectedRows, 0,
    'old worker cannot reclaim queue-owned work');
  assert.equal((await execute('claim', {story_ids:[3]})).rows[0].attempts, 3);
  assert.equal((await execute('claim', {story_ids:[5]})).rows[0].attempts, 2);
  const replacement = (await execute('claim', {story_ids:[6]})).rows[0];
  assert.equal(replacement.previous_image_url,
    'https://store.public.blob.vercel-storage.com/articles/6.png');
  assert.equal((await row(6)).image_status, 'ready');
} finally { await db.close(); }
'''
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script], capture_output=True, text=True,
        input=json.dumps({"base": migration_sql("0015_article_images.py"),
                          "queue": migration_sql("0016_image_queue.py"),
                          "queries": query_templates()}, default=str),
    )
    assert result.returncode == 0, result.stderr[-2500:]

"""Image lease and persistence contract at the repository boundary."""

import json
import os
import subprocess
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from pipeline.supabase import Repository

BLOB_URL = "https://store-123.public.blob.vercel-storage.com/articles/42.webp"


@pytest.fixture
def database(monkeypatch):
    connect = MagicMock()
    connection = connect.return_value.__enter__.return_value
    connection.execute.return_value.rowcount = 1
    monkeypatch.setattr("pipeline.supabase.psycopg.connect", connect)
    return Repository("postgresql://mock.invalid/test"), connect, connection


def test_claim_reaps_expired_final_attempt_and_leases_atomically(database):
    repo, _, connection = database
    connection.execute.return_value.fetchone.return_value = {
        "image_attempt_token": UUID("00000000-0000-0000-0000-000000000001")
    }
    assert repo.claim_image_attempt(42, max_attempts=3, stale_after_seconds=900) == (
        "00000000-0000-0000-0000-000000000001"
    )
    assert connection.execute.call_count == 2
    settle_sql, settle_params = connection.execute.call_args_list[0].args
    claim_sql, claim_params = connection.execute.call_args_list[1].args
    assert "CASE WHEN image_url IS NOT NULL THEN 'ready' ELSE 'failed' END" in settle_sql
    assert "image_status IN ('pending', 'ready')" in settle_sql
    assert "image_attempt_token IS NOT NULL" in settle_sql
    assert "image_attempt_count >= %(max_attempts)s" in settle_sql
    assert "image_attempted_at <= statement_timestamp()" in settle_sql
    assert "image_attempt_count" in claim_sql and "RETURNING image_attempt_token" in claim_sql
    assert "COALESCE(image_attempt_count, 0) < %(max_attempts)s" in claim_sql
    assert "image_status = 'pending'" in claim_sql
    assert "image_status = 'failed'" in claim_sql
    assert "image_status = 'ready'" in claim_sql
    assert "image_attempt_token IS NULL OR image_attempted_at" in claim_sql
    assert "%(replace)s" in claim_sql and claim_params["replace"] is False
    assert settle_params["stale_after_seconds"] == 900
    assert isinstance(claim_params["token"], UUID)


def test_missing_or_ineligible_row_returns_no_token(database):
    repo, _, connection = database
    connection.execute.return_value.fetchone.return_value = None
    assert repo.claim_image_attempt(42) is None


def test_save_ready_replaces_public_bundle_only_for_current_token(database):
    repo, _, connection = database
    token = "00000000-0000-0000-0000-000000000001"
    assert repo.save_image_ready(
        42, token, image_url=BLOB_URL, image_source_url="https://example.com/og.png",
        image_source_type="og", image_width=1200, image_height=630,
        image_mime_type="image/webp",
    )
    sql, params = connection.execute.call_args.args
    assert "WHERE hn_id = %(hn_id)s AND image_attempt_token = %(token)s" in sql
    assert "image_status = 'ready'" in sql
    assert "image_attempt_token = NULL" in sql and "image_attempt_count = 0" in sql
    assert params["token"] == UUID(token) and params["image_url"] == BLOB_URL
    connection.execute.return_value.rowcount = 0
    assert not repo.save_image_ready(
        42, token, image_url=BLOB_URL, image_source_url=None,
        image_source_type="generated", image_width=1200, image_height=630,
        image_mime_type="image/webp",
    )


def test_failure_preserves_ready_asset_and_private_provenance(database):
    repo, _, connection = database
    token = "00000000-0000-0000-0000-000000000001"
    assert repo.save_image_failed(42, token, reason="download timeout",
                                  image_source_url="https://elsewhere.test/og.jpg",
                                  image_source_type="twitter")
    sql, params = connection.execute.call_args.args
    assert "CASE WHEN image_url IS NOT NULL THEN 'ready' ELSE 'failed' END" in sql
    assert "THEN image_source_url ELSE %(image_source_url)s END" in sql
    assert "THEN image_source_type ELSE %(image_source_type)s END" in sql
    assert "image_attempt_token = NULL" in sql
    assert "WHERE hn_id = %(hn_id)s AND image_attempt_token = %(token)s" in sql
    assert "image_url =" not in sql and "image_width =" not in sql
    assert params["reason"] == "download timeout"
    connection.execute.return_value.rowcount = 0
    assert not repo.save_image_failed(42, token, reason="late worker")


@pytest.mark.parametrize("source_url", ["file:///etc/passwd", "https://user:pass@example.com/a"])
def test_blocked_discovery_url_still_finishes_failed_attempt(database, source_url):
    repo, _, connection = database
    token = "00000000-0000-0000-0000-000000000001"
    assert repo.save_image_failed(
        42, token, reason="blocked_url", image_source_url=source_url, image_source_type="og",
    )
    _, params = connection.execute.call_args.args
    assert params["image_source_url"] is None
    assert params["image_source_type"] == "og"


def test_backfill_scan_excludes_ready_images_and_caps_retries(database):
    repo, _, connection = database
    connection.execute.return_value.fetchall.return_value = [{"hn_id": 42, "url": "https://a.test"}]
    assert repo.list_unqueued_image_candidates(8) == [{"hn_id": 42, "url": "https://a.test"}]
    assert connection.execute.call_count == 2
    reap_sql, _ = connection.execute.call_args_list[0].args
    assert "image_status IN ('pending', 'ready')" in reap_sql
    assert "image_attempt_token IS NOT NULL" in reap_sql
    assert "LIMIT %(limit)s FOR UPDATE SKIP LOCKED" in reap_sql
    assert "CASE WHEN threads.image_url IS NOT NULL" in reap_sql
    sql, params = connection.execute.call_args_list[1].args
    assert "SELECT hn_id, url FROM hacker_news_threads" in sql
    assert "image_url IS NULL" in sql
    assert "COALESCE(image_attempt_count, 0) < %(max_attempts)s" in sql
    assert "image_status = 'failed'" in sql and "image_status = 'pending'" in sql
    assert "ORDER BY date_added DESC, hn_id DESC LIMIT %(limit)s" in sql
    assert params["limit"] == 8


@pytest.mark.parametrize("bad_url", [
    "https://example.com/articles/42.webp",
    "http://store.public.blob.vercel-storage.com/articles/42.webp",
    "https://evil.store.public.blob.vercel-storage.com/articles/42.webp",
    "https://store.public.blob.vercel-storage.com/not-articles/42.webp",
    "https://store.public.blob.vercel-storage.com/articles/42.webp?token=secret",
])
def test_ready_rejects_noncanonical_blob_url_before_connecting(database, bad_url):
    repo, connect, _ = database
    with pytest.raises(ValueError, match="canonical public Blob"):
        repo.save_image_ready(
            42, "00000000-0000-0000-0000-000000000001",
            image_url=bad_url, image_source_url=None, image_source_type="generated",
            image_width=1200, image_height=630, image_mime_type="image/webp",
        )
    connect.assert_not_called()


def test_bad_policy_and_metadata_are_rejected_before_connecting(database):
    repo, connect, _ = database
    with pytest.raises(ValueError, match="policy"):
        repo.claim_image_attempt(42, max_attempts=0)
    with pytest.raises(ValueError, match="limit"):
        repo.list_unqueued_image_candidates(1001)
    with pytest.raises(ValueError, match="dimensions"):
        repo.save_image_ready(
            42, "00000000-0000-0000-0000-000000000001", image_url=BLOB_URL,
            image_source_url=None, image_source_type="generated",
            image_width=0, image_height=630, image_mime_type="image/webp",
        )
    with pytest.raises(ValueError, match="nonblank"):
        repo.save_image_failed(42, "00000000-0000-0000-0000-000000000001", reason=" ")
    connect.assert_not_called()


@pytest.mark.skipif(not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"),
                    reason="optional PGlite runtime")
def test_postgres_claim_retry_replacement_and_stale_token(database):
    repo, _, connection = database

    def capture(operation):
        connection.execute.reset_mock()
        connection.execute.return_value.fetchone.return_value = {"image_attempt_token": UUID(int=1)}
        operation()
        return [
            {"sql": call.args[0], "params": call.args[1]}
            for call in connection.execute.call_args_list
        ]

    token = "00000000-0000-0000-0000-000000000001"
    queries = {
        "claim": capture(lambda: repo.claim_image_attempt(1)),
        "replace": capture(lambda: repo.claim_image_attempt(1, replace=True)),
        "ready": capture(lambda: repo.save_image_ready(
            1, token, image_url=BLOB_URL, image_source_url="https://publisher.test/og.png",
            image_source_type="og", image_width=1200, image_height=630,
            image_mime_type="image/webp",
        )),
        "failed": capture(lambda: repo.save_image_failed(1, token, reason="fetch_failed")),
        "candidates": capture(lambda: repo.list_unqueued_image_candidates(10)),
    }
    script = r'''
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const q = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();
await db.exec(`CREATE TABLE hacker_news_threads (
  hn_id bigint PRIMARY KEY, url text NOT NULL, date_added timestamptz NOT NULL DEFAULT now(),
  image_url text, image_source_url text, image_source_type text, image_status text,
  image_width integer, image_height integer, image_mime_type text,
  image_attempt_token uuid, image_attempt_count integer, image_attempted_at timestamptz,
  image_error text, image_queue_managed boolean NOT NULL DEFAULT false
);
INSERT INTO hacker_news_threads(hn_id,url) VALUES
  (1,'https://publisher.test/one'),(2,'https://publisher.test/two'),
  (3,'https://publisher.test/three'),(4,'https://publisher.test/four'),
  (5,'https://publisher.test/five');`);
async function execute(query, overrides={}) {
  const params = {...query.params, ...overrides};
  const keys = [];
  const sql = query.sql.replace(/%\((\w+)\)s/g, (_, key) => {
    if (!keys.includes(key)) keys.push(key);
    return '$' + (keys.indexOf(key) + 1);
  });
  return db.query(sql, keys.map(key => params[key]));
}
let tokenSequence = 10;
async function claim(queries, hn_id, overrides={}) {
  await execute(queries[0], {hn_id, ...overrides});
  tokenSequence += 1;
  const token = '00000000-0000-0000-0000-' + tokenSequence.toString(16).padStart(12, '0');
  const result = await execute(queries[1], {hn_id, token, ...overrides});
  return result.rows[0]?.image_attempt_token ?? null;
}
const first = await claim(q.claim, 1);
assert.ok(first);
let row = (await db.query('SELECT image_status,image_attempt_count FROM hacker_news_threads WHERE hn_id=1')).rows[0];
assert.equal(row.image_status, 'pending');
assert.equal(row.image_attempt_count, 1);
assert.equal((await execute(q.ready[0], {token:first})).affectedRows, 1);
row = (await db.query('SELECT image_status,image_url,image_attempt_token FROM hacker_news_threads WHERE hn_id=1')).rows[0];
assert.equal(row.image_status, 'ready');
assert.equal(row.image_url, q.ready[0].params.image_url);
assert.equal(row.image_attempt_token, null);
const replacement = await claim(q.replace, 1);
assert.ok(replacement);
row = (await db.query('SELECT image_status,image_url FROM hacker_news_threads WHERE hn_id=1')).rows[0];
assert.equal(row.image_status, 'ready');
assert.equal(row.image_url, q.ready[0].params.image_url);
assert.equal((await execute(q.failed[0], {token:replacement})).affectedRows, 1);
row = (await db.query('SELECT image_status,image_url,image_error FROM hacker_news_threads WHERE hn_id=1')).rows[0];
assert.equal(row.image_status, 'ready');
assert.equal(row.image_url, q.ready[0].params.image_url);
assert.equal(row.image_error, 'fetch_failed');
assert.equal(await claim(q.replace, 1), null); // replacement cooldown
await db.exec(`UPDATE hacker_news_threads SET image_attempted_at=now()-interval '2 hours' WHERE hn_id=1`);
const retry = await claim(q.replace, 1);
assert.ok(retry);
assert.notEqual(retry, replacement);
assert.equal((await execute(q.ready[0], {token:replacement})).affectedRows, 0); // late worker
await db.exec(`UPDATE hacker_news_threads
  SET image_status='pending',image_attempt_token='00000000-0000-0000-0000-000000000002',
      image_attempt_count=3,image_attempted_at=now()-interval '20 minutes' WHERE hn_id=2;
UPDATE hacker_news_threads
  SET image_status='ready',image_url='https://store.public.blob.vercel-storage.com/articles/3.webp',
      image_source_type='og',image_width=1200,image_height=630,image_mime_type='image/webp',
      image_attempt_token='00000000-0000-0000-0000-000000000003',
      image_attempt_count=3,image_attempted_at=now()-interval '20 minutes' WHERE hn_id=3;
UPDATE hacker_news_threads
  SET image_status='pending',image_attempt_token='00000000-0000-0000-0000-000000000004',
      image_attempt_count=1,image_attempted_at=now()-interval '20 minutes' WHERE hn_id=4;`);
assert.equal(await claim(q.claim, 2), null); // final crashed attempt
assert.equal(await claim(q.replace, 3), null); // final replacement crash
row = (await db.query(`SELECT image_status,image_attempt_token,image_url,image_error
  FROM hacker_news_threads WHERE hn_id=3`)).rows[0];
assert.equal(row.image_status, 'ready');
assert.equal(row.image_attempt_token, null);
assert.ok(row.image_url);
assert.equal(row.image_error, 'attempt_expired');
const reclaimed = await claim(q.claim, 4);
assert.ok(reclaimed);
assert.equal((await execute(q.ready[0], {hn_id:4,
  token:'00000000-0000-0000-0000-000000000004'})).affectedRows, 0);
await execute(q.candidates[0]);
const candidates = (await execute(q.candidates[1])).rows.map(row => Number(row.hn_id));
assert.deepEqual(candidates, [5]);
await db.close();
'''
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script], check=False,
        capture_output=True, text=True, input=json.dumps(queries, default=str),
    )
    assert result.returncode == 0, result.stderr

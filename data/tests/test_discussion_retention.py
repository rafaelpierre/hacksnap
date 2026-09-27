"""Offline migration checks plus optional in-memory PostgreSQL execution.

Set HACKSNAP_TEST_PGLITE_MODULE to a locally installed @electric-sql/pglite
entry point to execute the SQL without a server, credentials, or network.
"""
import json
import os
import re
import subprocess
from unittest.mock import MagicMock

import pytest
from test_discussion_migration import load_migration

from hn_trending.storage import DISCARD_REDUNDANT_CONTENTS, INSERT_SNAPSHOT, UPSERT_CONTENTS


def migration_sql(filename, direction="upgrade"):
    migration = load_migration(filename)
    migration.op = MagicMock()
    getattr(migration, direction)()
    return "\n".join(str(call.args[0]) for call in migration.op.execute.call_args_list)


def cleanup_sql(direction="upgrade"):
    return migration_sql("0013_discussion_retention.py", direction)


def test_retention_migration_is_reversible_and_keeps_grants_and_expiry():
    module = load_migration("0013_discussion_retention.py")
    assert module.down_revision == "0012_discussion_analysis"
    sql = cleanup_sql()
    assert "SECURITY INVOKER" in sql and "SKIP LOCKED" in sql
    assert "CREATE OR REPLACE FUNCTION" in sql
    assert "GRANT" not in sql and "DROP" not in sql
    assert sql.count("interval '7 days'") == 3
    assert "discussion_content_hash" in sql
    assert "public.hn_source_hash(p.raw_payload)" in sql
    previous = migration_sql("0008_disposable_contents_disposable_contents.py")
    previous = previous[previous.index("CREATE FUNCTION cleanup_hn_contents"):]
    previous = previous[:previous.index("END $$") + len("END $$")]
    assert " ".join(cleanup_sql("downgrade").split()) == " ".join(
        previous.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1).split()
    )


def test_collector_uses_discussion_acknowledgement_and_retains_legacy_rules():
    for sql in (UPSERT_CONTENTS, DISCARD_REDUNDANT_CONTENTS, INSERT_SNAPSHOT):
        assert "s.discussion_analysis IS NULL" in sql
        assert "s.discussion_content_hash" in sql
        assert "interval '7 days'" in sql
    assert "s.summarized_content_hash" in UPSERT_CONTENTS
    assert "s.summarized_content_hash" in DISCARD_REDUNDANT_CONTENTS


SETUP = """
CREATE TABLE hacker_news_threads (hn_id bigint PRIMARY KEY, date_added timestamptz DEFAULT now());
CREATE TABLE hn_thread_contents (
    hn_id bigint PRIMARY KEY, full_raw_text_contents text NOT NULL,
    content_hash text NOT NULL, fetched_at timestamptz DEFAULT now()
);
CREATE TABLE hacksnap_summaries (
    story_id bigint PRIMARY KEY, article_summary text, summarized_content_hash text,
    discussion_analysis jsonb, discussion_content_hash text
);
CREATE TABLE hn_thread_snapshots (
    snapshot_id bigserial PRIMARY KEY, hn_id bigint, raw_payload jsonb,
    observed_at timestamptz DEFAULT now(), run_id text, content_hash text,
    score integer, descendants integer, top_story_rank integer, max_comment_depth integer,
    UNIQUE (hn_id, content_hash)
);
INSERT INTO hacker_news_threads(hn_id) SELECT generate_series(1, 6);
-- 1: legacy; 2: refreshed; 3: failed/pending refresh; 4: older deployment;
-- 5: expired pending refresh; 6: no summary.
INSERT INTO hacksnap_summaries(story_id, article_summary, summarized_content_hash,
                               discussion_analysis, discussion_content_hash)
SELECT id, 'article', hn_source_hash('{"story":{"text":"old"},"comments":[]}'),
       CASE WHEN id = 1 THEN NULL ELSE '{}'::jsonb END,
       CASE WHEN id = 4 THEN NULL ELSE
           hn_source_hash(CASE WHEN id = 2 THEN '{"story":{"text":"new"},"comments":[]}'::jsonb
                              ELSE '{"story":{"text":"old"},"comments":[]}'::jsonb END) END
FROM generate_series(1, 5) id;
INSERT INTO hn_thread_contents(hn_id, full_raw_text_contents, content_hash)
SELECT id, payload::text, hn_source_hash(payload)
FROM generate_series(1, 6) id CROSS JOIN LATERAL (
    SELECT CASE WHEN id = 1 THEN '{"story":{"text":"old"},"comments":[]}'::jsonb
                ELSE '{"story":{"text":"new"},"comments":[]}'::jsonb END payload
) x;
-- Even matching article-summary hashes must not bypass discussion persistence.
UPDATE hacksnap_summaries s SET summarized_content_hash = c.content_hash
FROM hn_thread_contents c WHERE c.hn_id = s.story_id AND s.story_id IN (3,4);
INSERT INTO hn_thread_snapshots(hn_id, raw_payload, content_hash)
SELECT hn_id, full_raw_text_contents::jsonb, content_hash FROM hn_thread_contents;
UPDATE hacker_news_threads SET date_added = now() - interval '8 days' WHERE hn_id = 5;
"""

CHECKS = """
DO $$
DECLARE result record;
BEGIN
  SELECT * INTO result FROM cleanup_hn_contents(500);
  ASSERT result.contents_deleted = 3, 'legacy, refreshed and expired contents are eligible';
  ASSERT result.snapshots_cleared = 3, 'fresh snapshots must survive pending analysis';
  ASSERT (SELECT array_agg(hn_id ORDER BY hn_id) FROM hn_thread_contents) = ARRAY[3,4,6]::bigint[];
  ASSERT (SELECT array_agg(hn_id ORDER BY hn_id) FROM hn_thread_snapshots WHERE raw_payload IS NOT NULL)
         = ARRAY[3,4,6]::bigint[];
  -- A successful persistence now acknowledges exactly the retained input for 3.
  UPDATE hacksnap_summaries SET discussion_content_hash =
      (SELECT content_hash FROM hn_thread_contents WHERE hn_id = 3) WHERE story_id = 3;
  SELECT * INTO result FROM cleanup_hn_contents(1);
  ASSERT result.contents_deleted = 1 AND result.snapshots_cleared = 1;
  ASSERT NOT EXISTS (SELECT 1 FROM hn_thread_contents WHERE hn_id = 3);
  -- Seven days overrides missing analysis and missing acknowledgements.
  UPDATE hacker_news_threads SET date_added = now() - interval '8 days' WHERE hn_id IN (4,6);
  SELECT * INTO result FROM cleanup_hn_contents(500);
  ASSERT result.contents_deleted = 2 AND result.snapshots_cleared = 2;
  ASSERT NOT EXISTS (SELECT 1 FROM hn_thread_contents);
  ASSERT NOT EXISTS (SELECT 1 FROM hn_thread_snapshots WHERE raw_payload IS NOT NULL);
END $$;
"""


def parameterize(sql, params):
    """Translate psycopg named placeholders into PGlite positional parameters."""
    keys = []
    def replace(match):
        key = match.group(1)
        if key not in keys:
            keys.append(key)
        return f"${keys.index(key) + 1}"
    return {"sql": re.sub(r"%\((\w+)\)s", replace, sql), "params": [params[k] for k in keys]}


@pytest.mark.skipif(not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"), reason="optional PGlite runtime")
def test_postgres_retention_and_collector_execute_without_premature_cleanup():
    original = migration_sql("0008_disposable_contents_disposable_contents.py")
    start = original.index("CREATE FUNCTION hn_source_hash")
    source_hash_sql = original[start:original.index("$$", original.index("AS $$", start) + 5) + 2]
    payload = json.dumps({"story": {"text": "new evidence"}, "comments": []})
    params = dict(hn_id=20, full_raw_text_contents=payload, raw_payload=payload,
                  run_id="test", content_hash="snapshot", score=1, descendants=1,
                  top_story_rank=1, max_comment_depth=1)
    queries = [parameterize(sql, params) for sql in (UPSERT_CONTENTS, INSERT_SNAPSHOT, DISCARD_REDUNDANT_CONTENTS)]
    script = r'''
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const input = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();
await db.exec(input.hash);
await db.exec(input.setup);
await db.exec(input.cleanup);
await db.exec(input.checks);
await db.exec(`
  INSERT INTO hacker_news_threads(hn_id) VALUES (20);
  INSERT INTO hacksnap_summaries VALUES (20, 'article', 'original', '{}', NULL);
`);
for (const q of input.queries) await db.query(q.sql, q.params);
await db.exec(`DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM hn_thread_contents WHERE hn_id = 20);
  ASSERT EXISTS (SELECT 1 FROM hn_thread_snapshots WHERE hn_id = 20 AND raw_payload IS NOT NULL);
END $$;`);
// Even after cleanup, unprocessed new-format inputs survive.
await db.query('SELECT * FROM cleanup_hn_contents(500)');
await db.exec(`DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM hn_thread_contents WHERE hn_id = 20);
END $$;
UPDATE hacksnap_summaries SET discussion_content_hash =
  (SELECT content_hash FROM hn_thread_contents WHERE hn_id = 20) WHERE story_id = 20;`);
for (const q of input.queries) await db.query(q.sql, q.params);
await db.query('SELECT * FROM cleanup_hn_contents(500)');
await db.exec(`DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM hn_thread_contents WHERE hn_id = 20);
  ASSERT NOT EXISTS (SELECT 1 FROM hn_thread_snapshots WHERE hn_id = 20 AND raw_payload IS NOT NULL);
END $$;`);
// A is acknowledged and absent from retained contents. Ingest changed B,
// then A again before enrichment: A must remove B, not leave it queued.
const [upsert, , discard] = input.queries;
const changed = upsert.params.map(value => typeof value === 'string'
  ? value.replace('new evidence', 'pending evidence') : value);
await db.query(upsert.sql, changed);
await db.exec(`DO $$ BEGIN
  ASSERT EXISTS (SELECT 1 FROM hn_thread_contents WHERE hn_id = 20);
END $$;`);
await db.query(upsert.sql, upsert.params);
await db.query(discard.sql, discard.params);
await db.exec(`DO $$ BEGIN
  ASSERT NOT EXISTS (SELECT 1 FROM hn_thread_contents WHERE hn_id = 20),
    'Reverted acknowledged A must discard pending B';
END $$;`);
await db.exec(input.downgrade);
await db.close();
'''
    subprocess.run(["node", "--input-type=module", "-e", script], check=True, capture_output=True,
                   text=True, input=json.dumps({"hash": source_hash_sql, "setup": SETUP,
                       "cleanup": cleanup_sql(), "checks": CHECKS, "queries": queries,
                       "downgrade": cleanup_sql("downgrade")}))


def test_cleanup_acknowledgement_is_nullable_private_and_not_backfilled():
    module = load_migration("0013_discussion_retention.py")
    module.op = MagicMock()
    module.upgrade()
    table, column = module.op.add_column.call_args.args
    assert table == "hacksnap_summaries" and column.name == "discussion_content_hash"
    assert column.nullable and column.server_default is None
    assert "GRANT" not in cleanup_sql()
    module.downgrade()
    module.op.drop_column.assert_called_once_with("hacksnap_summaries", "discussion_content_hash")


def test_reverted_incoming_source_discards_any_older_pending_payload():
    # An acknowledged incoming A supersedes pending B; comparing B to A here
    # would leave B queued for the worker even though ingestion last observed A.
    assert "c.content_hash" not in DISCARD_REDUNDANT_CONTENTS
    assert "ELSE s.discussion_content_hash END = hn_source_hash(%(full_raw_text_contents)s::text::jsonb)" in DISCARD_REDUNDANT_CONTENTS


def test_snapshot_retention_uses_parameters_supplied_by_snapshot_row():
    from uuid import uuid4
    from hn_trending.storage import database_row, snapshot_row

    row = database_row({"id": 20, "title": "AI", "time": 1},
                       '{"story": {}, "comments": []}', top_story_rank=1, max_comment_depth=5)
    params = snapshot_row(row, uuid4())
    assert set(re.findall(r"%\((\w+)\)s", INSERT_SNAPSHOT)) <= params.keys()


def test_collector_serializes_discard_with_the_story_upsert(monkeypatch):
    from uuid import uuid4
    from hn_trending import storage

    connection = MagicMock()
    cursor = connection.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = None
    monkeypatch.setattr(storage.psycopg, "connect", lambda _: connection)
    connection.__enter__.return_value = connection
    row = storage.database_row({"id": 20, "title": "AI", "time": 1},
                               '{"story": {}, "comments": []}', top_story_rank=1, max_comment_depth=5)
    storage.store_threads_and_snapshots("unused", uuid4(), [row])
    # The row lock acquired by UPSERT_THREAD survives through the discard and
    # snapshot write. Another collector for this story must wait until commit.
    assert [call.args[0] for call in cursor.execute.call_args_list] == [
        storage.UPSERT_THREAD, UPSERT_CONTENTS, DISCARD_REDUNDANT_CONTENTS, INSERT_SNAPSHOT,
    ]
    connection.commit.assert_called_once_with()

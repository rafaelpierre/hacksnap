"""Stored slugs are assigned on insert and never backfilled on refresh."""
import json
import os
import subprocess
from io import StringIO

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations

from hn_trending.storage import UPSERT_THREAD, database_row
from hn_trending.story_slugs import story_slug
from test_discussion_migration import load_migration
from test_discussion_retention import parameterize


def render_migration(direction):
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output}
    )
    with Operations.context(context):
        getattr(load_migration("0014_story_slugs.py"), direction)()
    return output.getvalue()


def test_slug_normalization_and_duplicate_titles():
    assert story_slug(123, "Café’s AI: What's new?") == "cafes-ai-whats-new-123"
    assert story_slug(123, "🚀 中文") == "story-123"
    assert story_slug(123, "") == "story-123"
    assert story_slug(123, "Same title") != story_slug(124, "Same title")
    assert len(story_slug(999999999999999, "long title " * 30)) <= 96
    assert story_slug(123, "a" * 80 + " and more") == "a" * 80 + "-123"


def test_migration_adds_only_nullable_slug_without_backfill():
    sql = render_migration("upgrade")
    assert "ADD COLUMN story_slug TEXT" in sql
    assert "DEFAULT" not in sql and "NOT NULL" not in sql
    assert "UPDATE " not in sql and "INSERT " not in sql
    assert "GRANT SELECT (story_slug) ON hacker_news_threads TO hacksnap_reader" in sql
    assert "CREATE POLICY" not in sql and "DISABLE ROW LEVEL SECURITY" not in sql
    assert load_migration("0014_story_slugs.py").down_revision == "0013_discussion_retention"
    assert "story_slug" not in UPSERT_THREAD.split("DO UPDATE SET")[1]
    downgrade = render_migration("downgrade")
    assert downgrade.index("REVOKE SELECT") < downgrade.index("DROP COLUMN")


SETUP = """
CREATE ROLE hacksnap_reader;
CREATE TABLE hn_items (hn_id bigint PRIMARY KEY);
CREATE TABLE hacker_news_threads (
    hn_id bigint PRIMARY KEY, title text, url text,
    date_published timestamptz, date_added timestamptz, author text,
    points int, comment_count int, last_seen_run_id uuid,
    category text, category_version text, category_model text,
    categorized_at timestamptz, category_title_hash text
);
INSERT INTO hacker_news_threads(hn_id,title,date_added) VALUES (123,'Existing headline','2026-01-01');
GRANT SELECT (hn_id,title) ON hacker_news_threads TO hacksnap_reader;
"""


@pytest.mark.skipif(not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"), reason="optional PGlite runtime")
def test_ingestion_preserves_old_numeric_urls_and_new_saved_slugs():
    queries = []
    for story_id, title in [(123, "Refreshed old title"), (124, "New headline"),
                            (124, "Changed headline"), (125, "New headline")]:
        row = database_row({"id": story_id, "title": title, "time": 1}, "{}",
                           top_story_rank=1, max_comment_depth=1)
        assert row["story_slug"] == story_slug(story_id, title)
        queries.append(parameterize(UPSERT_THREAD, {**row, "last_seen_run_id": None}))
    script = r'''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const input = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();
try {
  await db.exec(input.setup);
  await db.exec(input.upgrade);
  assert.equal((await db.query('SELECT story_slug FROM hacker_news_threads')).rows[0].story_slug, null);
  for (const query of input.queries) await db.query(query.sql, query.params);
  const rows = (await db.query('SELECT hn_id,title,story_slug,date_added FROM hacker_news_threads ORDER BY hn_id')).rows;
  assert.equal(rows[0].story_slug, null);
  assert.equal(rows[0].title, 'Refreshed old title');
  assert.equal(new Date(rows[0].date_added).toISOString(), '2026-01-01T00:00:00.000Z');
  assert.equal(rows[1].story_slug, 'new-headline-124');
  assert.equal(rows[1].title, 'Changed headline');
  assert.equal(rows[2].story_slug, 'new-headline-125');
  for (const slug of ['wrong-125', 'UPPER-124', '../bad-124', 'a'.repeat(100)+'-124']) {
    await assert.rejects(db.query('UPDATE hacker_news_threads SET story_slug=$1 WHERE hn_id=124',[slug]), /hn_story_slug_format/);
  }
  await db.exec('SET ROLE hacksnap_reader');
  assert.equal((await db.query('SELECT story_slug FROM hacker_news_threads WHERE hn_id=124')).rows[0].story_slug,'new-headline-124');
  await assert.rejects(db.query('SELECT category_model FROM hacker_news_threads'), /permission denied/);
  await assert.rejects(db.query("UPDATE hacker_news_threads SET story_slug='changed-124' WHERE hn_id=124"), /permission denied/);
  await db.exec('RESET ROLE');
  await db.exec(input.downgrade);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM hacker_news_threads')).rows[0].count,3);
} finally { await db.close(); }
'''
    result = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True,
                            text=True, input=json.dumps({"setup": SETUP,
                                "upgrade": render_migration("upgrade"), "queries": queries,
                                "downgrade": render_migration("downgrade")}, default=str))
    assert result.returncode == 0, result.stderr

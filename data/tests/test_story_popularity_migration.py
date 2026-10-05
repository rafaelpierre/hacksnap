"""Exercise counter permissions and atomic deduplication without production access."""

from io import StringIO
import json
import os
from pathlib import Path
import re
import subprocess

from alembic.migration import MigrationContext
from alembic.operations import Operations
import pytest

from test_discussion_migration import load_migration


def render(direction: str) -> str:
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output}
    )
    migration = load_migration("0019_story_popularity.py")
    with Operations.context(context):
        getattr(migration, direction)()
    return output.getvalue()


def test_additive_popularity_schema_and_scoped_grants():
    migration = load_migration("0019_story_popularity.py")
    assert migration.down_revision == "0018_discussion_themes_schema"
    sql = render("upgrade")
    assert "PRIMARY KEY (visit_id, story_id, kind)" in sql
    assert sql.count("ENABLE ROW LEVEL SECURITY") == 2
    assert "UPDATE (story_views, story_clicks)" in sql
    assert "INSERT (story_id, story_views, story_clicks)" in sql
    assert "FROM PUBLIC, anon, authenticated" in sql
    assert "SECURITY DEFINER" not in sql
    assert "GRANT SELECT (visit_id, story_id, kind), INSERT" in sql
    assert "DROP ROLE hacksnap_counter" in render("downgrade")


@pytest.mark.skipif(
    not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"), reason="optional PGlite runtime"
)
def test_atomic_events_and_real_role_permissions():
    source = (Path(__file__).parents[2] / "hacksnap/web/lib/story-events.ts").read_text()
    query = re.search(r"export const recordStoryEventSQL = `([^`]+)`;", source).group(1)
    script = r'''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const input = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();
const visit = '00000000-0000-4000-8000-000000000001';
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE hacksnap_reader;
    CREATE TABLE hacker_news_threads (hn_id bigint PRIMARY KEY, date_added timestamptz NOT NULL);
    ALTER TABLE hacker_news_threads ENABLE ROW LEVEL SECURITY;
    INSERT INTO hacker_news_threads VALUES (123,now()),(124,now()),(125,now()+interval '1 day');`);
  await db.exec(input.upgrade);
  await db.exec("INSERT INTO hacksnap_story_popularity(story_id,historical_views) VALUES(123,322)");
  await db.exec('SET ROLE hacksnap_counter');
  // Real simultaneous submissions are serialized by PGlite, but exercise duplicate SQL inputs.
  await Promise.all(Array.from({length:12},()=>db.query(input.query,[visit,'123','view'])));
  await db.query(input.query,[visit,'123','click']);
  await db.query(input.query,[visit,'124','view']);
  await db.query(input.query,[visit,'999','view']);
  await db.query(input.query,[visit,'125','view']);
  assert.deepEqual((await db.query('SELECT story_views::text,story_clicks::text FROM hacksnap_story_popularity WHERE story_id=123')).rows,
    [{story_views:'1',story_clicks:'1'}]);
  await assert.rejects(db.query('SELECT historical_views FROM hacksnap_story_popularity'), /permission denied/);
  await assert.rejects(db.query('UPDATE hacksnap_story_popularity SET historical_views=999 WHERE story_id=123'), /permission denied/);
  await assert.rejects(db.query('DELETE FROM hacksnap_popularity_events'), /permission denied/);
  await assert.rejects(db.query('INSERT INTO hacksnap_popularity_events(visit_id,story_id,kind) VALUES($1,125,\'view\')',[visit]), /row-level security/);
  await assert.rejects(db.query('UPDATE hacksnap_story_popularity SET story_views=-1 WHERE story_id=123'), /check constraint/);
  await db.exec('RESET ROLE');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM hacksnap_popularity_events')).rows[0].n,3);
  assert.equal((await db.query('SELECT historical_views::text AS n FROM hacksnap_story_popularity WHERE story_id=123')).rows[0].n,'322');
  // A failed tally update rolls back the receipt in the same statement.
  await db.exec("ALTER TABLE hacksnap_story_popularity ADD CONSTRAINT no_more_views CHECK(story_views<=1)");
  const other = '00000000-0000-4000-8000-000000000002';
  await db.exec('SET ROLE hacksnap_counter');
  await assert.rejects(db.query(input.query,[other,'123','view']), /no_more_views/);
  await db.exec('RESET ROLE');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM hacksnap_popularity_events WHERE visit_id=$1',[other])).rows[0].n,0);
  await db.exec('ALTER TABLE hacksnap_story_popularity DROP CONSTRAINT no_more_views');
  await db.exec('SET ROLE hacksnap_counter');
  await db.query(input.query,[other,'123','view']);
  await db.exec('RESET ROLE; SET ROLE hacksnap_reader');
  assert.equal((await db.query('SELECT historical_views::text AS historical,story_views::text AS live FROM hacksnap_story_popularity WHERE story_id=123')).rows[0].live,'2');
  await assert.rejects(db.query('SELECT * FROM hacksnap_popularity_events'), /permission denied/);
  await assert.rejects(db.query('UPDATE hacksnap_story_popularity SET story_views=5'), /permission denied/);
  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(db.query('SELECT * FROM hacksnap_story_popularity'), /permission denied/);
  await db.exec('RESET ROLE');
  await db.exec(input.downgrade);
  assert.equal((await db.query("SELECT to_regclass('hacksnap_story_popularity') AS table_name")).rows[0].table_name,null);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname='hacksnap_counter'")).rows[0].n,0);
} finally { await db.close(); }
'''
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        capture_output=True,
        text=True,
        input=json.dumps({"upgrade": render("upgrade"), "downgrade": render("downgrade"), "query": query}),
    )
    assert result.returncode == 0, result.stderr

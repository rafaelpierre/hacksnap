"""Check weekly reader access without exposing visit IDs or write privileges."""

import json
import os
import subprocess

import pytest

from test_story_popularity_migration import render
from test_discussion_migration import load_migration


def test_weekly_migration_is_additive_and_reversible():
    migration = load_migration("0021_weekly_story_popularity.py")
    assert migration.down_revision == "0020_story_popularity_activation"
    sql = render("upgrade", "0021_weekly_story_popularity.py")
    assert "ON public.hacksnap_popularity_events(received_at, story_id)" in sql
    assert "WHERE kind = 'view'" in sql
    assert "GRANT SELECT (story_id, kind, received_at)" in sql
    assert "FOR SELECT TO hacksnap_reader USING (kind = 'view')" in sql
    assert "visit_id" not in sql
    assert "SECURITY DEFINER" not in sql
    assert "DROP POLICY hacksnap_web_recent_views" in render(
        "downgrade", "0021_weekly_story_popularity.py"
    )


@pytest.mark.skipif(
    not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"), reason="optional PGlite runtime"
)
def test_reader_can_rank_views_but_cannot_access_identifiers_clicks_or_writes():
    script = r'''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const input = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE hacksnap_reader;
    CREATE TABLE hacker_news_threads(hn_id bigint PRIMARY KEY,date_added timestamptz);
    INSERT INTO hacker_news_threads VALUES(1,now());`);
  await db.exec(input.base + input.upgrade);
  await db.exec(`INSERT INTO hacksnap_popularity_events(visit_id,story_id,kind) VALUES
    ('00000000-0000-4000-8000-000000000001',1,'view'),
    ('00000000-0000-4000-8000-000000000001',1,'click');
    SET ROLE hacksnap_reader;`);
  assert.deepEqual((await db.query('SELECT story_id::text,kind FROM hacksnap_popularity_events')).rows,
    [{story_id:'1',kind:'view'}]);
  assert.equal((await db.query("SELECT count(*)::int AS views FROM hacksnap_popularity_events WHERE kind='view' AND received_at >= now()-interval '168 hours'")).rows[0].views,1);
  await assert.rejects(db.query('SELECT visit_id FROM hacksnap_popularity_events'), /permission denied/);
  await assert.rejects(db.query('SELECT * FROM hacksnap_popularity_events'), /permission denied/);
  await assert.rejects(db.query("UPDATE hacksnap_popularity_events SET kind='click'"), /permission denied/);
  await assert.rejects(db.query('DELETE FROM hacksnap_popularity_events'), /permission denied/);
  await assert.rejects(db.query("INSERT INTO hacksnap_popularity_events(story_id,kind) VALUES(1,'view')"), /permission denied/);
  for (const role of ['anon','authenticated']) {
    await db.exec('RESET ROLE; SET ROLE '+role);
    await assert.rejects(db.query('SELECT story_id,kind,received_at FROM hacksnap_popularity_events'), /permission denied/);
  }
  await db.exec('RESET ROLE');
  await db.exec(input.downgrade);
  await db.exec('SET ROLE hacksnap_reader');
  await assert.rejects(db.query('SELECT story_id FROM hacksnap_popularity_events'), /permission denied/);
  await db.exec('RESET ROLE; SET ROLE hacksnap_counter');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM hacksnap_popularity_events')).rows[0].n,2);
} finally { await db.close(); }
'''
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        capture_output=True,
        text=True,
        input=json.dumps({
            "base": render("upgrade"),
            "upgrade": render("upgrade", "0021_weekly_story_popularity.py"),
            "downgrade": render("downgrade", "0021_weekly_story_popularity.py"),
        }),
    )
    assert result.returncode == 0, result.stderr

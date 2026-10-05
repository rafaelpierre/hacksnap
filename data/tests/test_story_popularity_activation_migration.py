"""Activation state is additive and conservatively freezes an already-used counter."""

import json
import os
import subprocess

import pytest

from test_discussion_migration import load_migration
from test_story_popularity_migration import render

MIGRATION = "0020_story_popularity_activation.py"


def test_activation_migration_preserves_released_counter_schema_and_role():
    migration = load_migration(MIGRATION)
    assert migration.down_revision == "0019_story_popularity"
    sql = render("upgrade", MIGRATION)
    assert "singleton boolean PRIMARY KEY CHECK (singleton)" in sql
    assert "ENABLE ROW LEVEL SECURITY" in sql
    assert "GRANT SELECT (singleton, tracking_started_at)" in sql
    assert "FROM PUBLIC, anon, authenticated" in sql
    assert "WHERE story_views > 0 OR story_clicks > 0" in sql
    assert "EXISTS (SELECT 1 FROM public.hacksnap_popularity_events)" in sql
    assert "rolname = 'hacksnap_counter' AND rolcanlogin" in sql
    assert "IN SHARE ROW EXCLUSIVE MODE" in sql
    assert "GRANT INSERT" not in sql and "GRANT UPDATE" not in sql
    assert "CREATE ROLE" not in sql and "ALTER ROLE" not in sql
    assert "DROP TABLE public.hacksnap_popularity_state" in render("downgrade", MIGRATION)
    assert "DROP ROLE" not in render("downgrade", MIGRATION)


@pytest.mark.skipif(
    not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"), reason="optional PGlite runtime"
)
def test_existing_evidence_freezes_baseline_and_rollback_preserves_live_counts():
    script = r'''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const input = JSON.parse(readFileSync(0, 'utf8'));
for (const evidence of ['none','historical_only','receipt_only','views_only','clicks_only','login_only']) {
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE hacksnap_reader;
      CREATE TABLE hacker_news_threads(hn_id bigint PRIMARY KEY,date_added timestamptz NOT NULL);
      ALTER TABLE hacker_news_threads ENABLE ROW LEVEL SECURITY;
      INSERT INTO hacker_news_threads VALUES(123,now());`);
    await db.exec(input.counter);
    if (evidence==='historical_only')
      await db.exec('INSERT INTO hacksnap_story_popularity(story_id,historical_views) VALUES(123,322)');
    if (evidence==='receipt_only')
      await db.exec("INSERT INTO hacksnap_popularity_events(visit_id,story_id,kind) VALUES('00000000-0000-4000-8000-000000000001',123,'click')");
    if (evidence==='views_only')
      await db.exec('INSERT INTO hacksnap_story_popularity(story_id,story_views) VALUES(123,1)');
    if (evidence==='clicks_only')
      await db.exec('INSERT INTO hacksnap_story_popularity(story_id,story_clicks) VALUES(123,1)');
    if (evidence==='login_only')
      await db.exec('ALTER ROLE hacksnap_counter LOGIN');
    const before=(await db.query('SELECT clock_timestamp() AS time')).rows[0].time;
    await db.exec(input.upgrade);
    const active=(await db.query('SELECT singleton,tracking_started_at FROM hacksnap_popularity_state')).rows;
    assert.equal(active.length,1);
    assert.equal(active[0].singleton,true);
    const started=active[0].tracking_started_at;
    assert.equal(started!==null,!['none','historical_only'].includes(evidence),evidence);
    if (started) assert.ok(new Date(started).getTime()>=new Date(before).getTime());
    await assert.rejects(db.query('INSERT INTO hacksnap_popularity_state VALUES(false,NULL)'), /check constraint/);
    await db.exec('SET ROLE hacksnap_counter');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM hacksnap_popularity_state')).rows[0].n,1);
    await assert.rejects(db.query('UPDATE hacksnap_popularity_state SET tracking_started_at=NULL'), /permission denied/);
    await assert.rejects(db.query('DELETE FROM hacksnap_popularity_state'), /permission denied/);
    await db.exec('RESET ROLE; SET ROLE hacksnap_reader');
    await assert.rejects(db.query('SELECT * FROM hacksnap_popularity_state'), /permission denied/);
    await db.exec('RESET ROLE; SET ROLE anon');
    await assert.rejects(db.query('SELECT * FROM hacksnap_popularity_state'), /permission denied/);
    await db.exec('RESET ROLE; SET ROLE authenticated');
    await assert.rejects(db.query('SELECT * FROM hacksnap_popularity_state'), /permission denied/);
    await db.exec('RESET ROLE');
    const tally=(await db.query('SELECT story_id::text,historical_views::text,story_views::text,story_clicks::text FROM hacksnap_story_popularity')).rows;
    const receipts=(await db.query('SELECT count(*)::int AS n FROM hacksnap_popularity_events')).rows[0].n;
    await db.exec(input.downgrade);
    assert.equal((await db.query("SELECT to_regclass('hacksnap_popularity_state') AS t")).rows[0].t,null);
    assert.deepEqual((await db.query('SELECT story_id::text,historical_views::text,story_views::text,story_clicks::text FROM hacksnap_story_popularity')).rows,tally);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM hacksnap_popularity_events')).rows[0].n,receipts);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname='hacksnap_counter'")).rows[0].n,1);
  } finally { await db.close(); }
}
'''
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        capture_output=True,
        text=True,
        input=json.dumps({
            "counter": render("upgrade"),
            "upgrade": render("upgrade", MIGRATION),
            "downgrade": render("downgrade", MIGRATION),
        }),
    )
    assert result.returncode == 0, result.stderr

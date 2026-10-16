"""Exercise transactional notifications, rollback, and privileges in PostgreSQL."""

import json
import os
import subprocess

import pytest

from test_story_popularity_migration import render

MIGRATION = "0024_publication_cache_publication_outbox_and_initial_snapshot_.py"


def test_publication_outbox_is_private_and_additive():
    sql = render("upgrade", MIGRATION)
    assert "ENABLE ROW LEVEL SECURITY" in sql
    assert "SECURITY DEFINER" not in sql
    assert "GRANT SELECT (snapshot_id, score, descendants)" in sql
    assert "WHERE delivered_at IS NULL" in sql
    assert "UPDATE hacker_news_threads" not in sql


@pytest.mark.skipif(not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"), reason="optional PGlite runtime")
def test_public_changes_commit_with_notifications_and_rollback_together():
    script = r'''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const sql = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE hacksnap_reader; CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE hn_thread_snapshots(snapshot_id bigint, score int, descendants int, raw_payload jsonb);
    CREATE TABLE hacker_news_threads(hn_id bigint PRIMARY KEY, title text, url text, category text,
      story_slug text, date_added timestamptz, points int, comment_count int, image_url text,
      image_status text, image_source_type text, image_width int, image_height int, image_mime_type text);
    CREATE TABLE hacksnap_summaries(story_id bigint PRIMARY KEY REFERENCES hacker_news_threads ON DELETE CASCADE,
      title text, article_summary text, article_key_points jsonb, discussion_summary text,
      discussion_points jsonb, overall_takeaway text, sentiment int, source_coverage jsonb,
      discussion_analysis jsonb, discussion_analyzed_at timestamptz, discussion_analysis_coverage jsonb,
      content_hash text);
    CREATE TABLE hacksnap_fetch_failures(story_id bigint PRIMARY KEY, article_url text);
    INSERT INTO hacker_news_threads(hn_id, points, comment_count) VALUES(123,1,2),(124,3,4);`);
  await db.exec(sql.upgrade);
  const events = async () => (await db.query('SELECT story_id::text AS id, kind FROM hacksnap_publication_outbox ORDER BY event_id')).rows;
  await db.exec('UPDATE hacker_news_threads SET points=42 WHERE hn_id=124');
  assert.equal((await db.query('SELECT points FROM hacker_news_threads WHERE hn_id=124')).rows[0].points,42);
  await db.exec(`BEGIN; INSERT INTO hacksnap_summaries(story_id,overall_takeaway) VALUES(123,'Ready'); ROLLBACK;`);
  assert.deepEqual(await events(), []);
  await db.exec(`INSERT INTO hacksnap_summaries(story_id,overall_takeaway) VALUES(123,'Ready');
    UPDATE hacker_news_threads SET points=999, comment_count=999 WHERE hn_id=123;
    UPDATE hacker_news_threads SET image_url='private-image', image_status='pending', image_source_type='og' WHERE hn_id=123;
    UPDATE hacker_news_threads SET image_status='ready', image_source_type='generated' WHERE hn_id=123;
    UPDATE hacksnap_summaries SET content_hash='provenance-only' WHERE story_id=123;`);
  assert.deepEqual(await events(), [{id:'123',kind:'publication'}]);
  await db.exec(`UPDATE hacksnap_summaries SET overall_takeaway='Corrected' WHERE story_id=123;
    UPDATE hacker_news_threads SET image_url='https://example.test/image.webp', image_status='ready', image_source_type='og' WHERE hn_id=123;
    INSERT INTO hacksnap_fetch_failures VALUES(123,'https://example.test');
    DELETE FROM hacksnap_fetch_failures;
    UPDATE hacksnap_summaries SET overall_takeaway='' WHERE story_id=123;`);
  assert.deepEqual((await events()).map(x=>x.kind), ['publication','correction','image','removal','correction','removal']);
  await db.exec(`UPDATE hacksnap_summaries SET overall_takeaway='Published again' WHERE story_id=123;
    DELETE FROM hacker_news_threads WHERE hn_id=123;`);
  assert.equal((await events()).at(-1).kind,'removal');
  for (const role of ['hacksnap_reader','anon','authenticated']) {
    await db.exec('SET ROLE '+role);
    await assert.rejects(db.query('SELECT * FROM hacksnap_publication_outbox'), /permission denied/);
    await assert.rejects(db.query("INSERT INTO hacksnap_publication_outbox(story_id,kind) VALUES(1,'removal')"), /permission denied/);
    await db.exec('RESET ROLE');
  }
  await db.exec('SET ROLE hacksnap_reader');
  await db.query('SELECT snapshot_id,score,descendants FROM hn_thread_snapshots');
  await assert.rejects(db.query('SELECT raw_payload FROM hn_thread_snapshots'), /permission denied/);
  await db.exec('RESET ROLE');
  await db.exec(sql.seo);
  await db.exec(`INSERT INTO hacksnap_summaries(story_id,overall_takeaway) VALUES(124,'Preserved article');
    UPDATE hacksnap_summaries SET seo_title='Preserved SEO',seo_description='Preserved description.',
      seo_metadata='{}' WHERE story_id=124;`);
  await db.exec(sql.retire);
  assert.equal((await db.query("SELECT to_regclass('hacksnap_publication_outbox') AS name")).rows[0].name, null);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname IN ('hacksnap_summary_publication','hacksnap_thread_publication','hacksnap_fetch_withdrawal','hacksnap_seo_publication','hacksnap_seo_inputs','hacksnap_seo_original_title')")).rows[0].n, 0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='hacksnap_summaries' AND column_name IN ('seo_pending','seo_input_version','seo_attempted_at')")).rows[0].n, 0);
  await db.exec(`UPDATE hacker_news_threads SET title='Corrected source' WHERE hn_id=124;
    UPDATE hacksnap_summaries SET article_summary='Corrected summary' WHERE story_id=124;
    INSERT INTO hacksnap_fetch_failures VALUES(124,'https://example.test');
    DELETE FROM hacksnap_fetch_failures;`);
  const saved = (await db.query('SELECT overall_takeaway,seo_title FROM hacksnap_summaries WHERE story_id=124')).rows[0];
  assert.deepEqual(saved, {overall_takeaway:'Preserved article',seo_title:'Preserved SEO'});
  await db.exec('SET ROLE hacksnap_reader');
  await db.query('SELECT seo_title,seo_description FROM hacksnap_summaries');
  await assert.rejects(db.query('SELECT seo_metadata FROM hacksnap_summaries'), /permission denied/);
  await db.exec('RESET ROLE');
  await db.exec(sql.restore);
  await db.exec("UPDATE hacksnap_summaries SET overall_takeaway='Rollback publication' WHERE story_id=124");
  assert.equal((await events()).length, 2, 'rollback restores summary and SEO notifications');
  await db.exec(sql.seo_down);
  await db.exec(sql.downgrade);
} finally { await db.close(); }
'''
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script], capture_output=True, text=True,
        input=json.dumps({
            "upgrade": render("upgrade", MIGRATION), "downgrade": render("downgrade", MIGRATION),
            "seo": render("upgrade", "0025_article_seo_article_seo_metadata.py"),
            "seo_down": render("downgrade", "0025_article_seo_article_seo_metadata.py"),
            "retire": render("upgrade", "0026_retire_webhook_retire_publication_notifications.py"),
            "restore": render("downgrade", "0026_retire_webhook_retire_publication_notifications.py"),
        }),
    )
    assert result.returncode == 0, result.stderr

"""Validate durable SEO work, invalidation, CAS writes and reader access in Postgres."""
import json
import os
import subprocess

import pytest

from test_story_popularity_migration import render

MIGRATION = "0025_article_seo_article_seo_metadata.py"


def test_seo_migration_is_additive_and_does_not_queue_the_archive():
    sql = render("upgrade", MIGRATION)
    assert "seo_pending boolean NOT NULL DEFAULT false" in sql
    assert "GRANT SELECT (seo_title, seo_description)" in sql
    assert "SECURITY DEFINER" not in sql
    assert "DROP COLUMN seo_metadata" in render("downgrade", MIGRATION)


@pytest.mark.skipif(not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"), reason="optional PGlite runtime")
def test_queue_invalidation_concurrency_and_permissions():
    script = r'''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const input = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE hacksnap_reader; CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE hacker_news_threads (hn_id bigint PRIMARY KEY, title text, points int);
    CREATE TABLE hacksnap_summaries (story_id bigint PRIMARY KEY, title text, article_summary text,
      article_key_points jsonb, overall_takeaway text, discussion_points jsonb, source_coverage jsonb,
      discussion_analysis jsonb, sentiment int);
    ALTER TABLE hacksnap_summaries ENABLE ROW LEVEL SECURITY;
    CREATE POLICY reader ON hacksnap_summaries FOR SELECT TO hacksnap_reader USING (true);
    CREATE TABLE hacksnap_publication_outbox (story_id bigint, kind text);
    INSERT INTO hacker_news_threads VALUES (1,'Old title',10),(2,'New title',20);
    INSERT INTO hacksnap_summaries (story_id,overall_takeaway) VALUES (1,'Old publication');`);
  await db.exec(input.upgrade);
  const state = async id => (await db.query('SELECT * FROM hacksnap_summaries WHERE story_id=$1',[id])).rows[0];
  assert.equal((await state(1)).seo_pending, false, 'archive must not be queued by migration');
  await db.exec(`INSERT INTO hacksnap_summaries (story_id,title,overall_takeaway,source_coverage)
    VALUES (2,'Visible headline','New publication','{"article_status":"fetched"}');`);
  assert.equal((await state(2)).seo_pending, true);
  await db.exec(`UPDATE hacksnap_summaries SET seo_title='SEO title', seo_description='SEO description.',
    seo_metadata='{"generation_version":"v1"}',seo_pending=false,seo_attempted_at=now() WHERE story_id=2;`);
  assert.deepEqual((await db.query('SELECT * FROM hacksnap_publication_outbox')).rows,
    [{story_id:2,kind:'correction'}]);
  const version = (await state(2)).seo_input_version;
  await db.exec(`UPDATE hacker_news_threads SET points=100 WHERE hn_id=2;
    UPDATE hacksnap_summaries SET sentiment=1,discussion_analysis='{"topics":["new"]}',
      source_coverage=source_coverage || '{"sentiment":{"included_comments":10}}' WHERE story_id=2;`);
  assert.equal((await state(2)).seo_pending, false);
  assert.equal((await state(2)).seo_input_version, version);
  assert.equal((await state(2)).seo_title, 'SEO title');
  await db.exec(`UPDATE hacksnap_summaries SET overall_takeaway='A corrected finding' WHERE story_id=2`);
  assert.equal((await state(2)).seo_pending, true);
  assert.equal((await state(2)).seo_title, null);
  assert.equal((await state(2)).seo_attempted_at, null);
  assert.equal((await state(2)).seo_input_version, version+1);
  const stale = await db.query(`UPDATE hacksnap_summaries SET seo_title='Stale',
    seo_description='Stale copy.',seo_metadata='{}',seo_pending=false
    WHERE story_id=2 AND seo_input_version=$1 RETURNING story_id`,[version]);
  assert.equal(stale.rows.length, 0, 'in-flight stale generation must not win');
  await db.exec(`UPDATE hacker_news_threads SET title='Corrected original' WHERE hn_id=2`);
  assert.equal((await state(2)).seo_input_version, version+2);
  assert.equal((await state(1)).seo_pending, false);
  await assert.rejects(db.exec(`UPDATE hacksnap_summaries SET seo_title='partial' WHERE story_id=2`), /check constraint/);
  await db.exec(`UPDATE hacksnap_summaries SET seo_title='Final title',seo_description='Final copy.',
    seo_metadata='{}',seo_pending=false WHERE story_id=2`);
  await db.exec('SET ROLE hacksnap_reader');
  assert.equal((await db.query('SELECT seo_title FROM hacksnap_summaries WHERE seo_title IS NOT NULL')).rows[0].seo_title,'Final title');
  await assert.rejects(db.query('SELECT seo_metadata FROM hacksnap_summaries'), /permission denied/);
  await assert.rejects(db.query("UPDATE hacksnap_summaries SET seo_pending=true"), /permission denied/);
  for (const role of ['anon','authenticated']) {
    await db.exec(`RESET ROLE; SET ROLE ${role}`);
    await assert.rejects(db.query('SELECT seo_title FROM hacksnap_summaries'), /permission denied/);
  }
  await db.exec('RESET ROLE');
  await db.exec(input.downgrade);
  assert.equal((await state(2)).overall_takeaway, 'A corrected finding');
} finally { await db.close(); }
'''
    result = subprocess.run(["node", "--input-type=module", "-e", script], text=True,
        capture_output=True, input=json.dumps({"upgrade": render("upgrade", MIGRATION),
                                              "downgrade": render("downgrade", MIGRATION)}))
    assert result.returncode == 0, result.stderr

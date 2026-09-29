import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../hacksnap/web/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
try {
  await db.exec(`
    CREATE TABLE hacksnap_ranked_stories (hn_id bigint PRIMARY KEY, rank bigint NOT NULL);
    CREATE TABLE hacker_news_threads (hn_id bigint PRIMARY KEY, date_added timestamptz NOT NULL);
    CREATE TABLE hn_thread_contents (hn_id bigint PRIMARY KEY, full_raw_text_contents text NOT NULL);
    CREATE TABLE hacksnap_summaries (story_id bigint PRIMARY KEY, overall_takeaway text);
    INSERT INTO hacksnap_ranked_stories VALUES
      (1,1),(2,20),(3,60),(4,61),(5,62),(6,63),(7,110),(8,111);
    INSERT INTO hacker_news_threads
      SELECT hn_id, now() - interval '4 hours' FROM hacksnap_ranked_stories;
    INSERT INTO hn_thread_contents VALUES (1,'{}'),(2,'{}'),(4,'{}'),(5,'{}'),(6,'{}');
    INSERT INTO hacksnap_summaries VALUES
      (1,'Ready'),(4,''),(5,E' \\t\\n'),(6,NULL),(7,'  '),(8,'Ready without source');
  `);
  const results = await db.exec(readFileSync(new URL('./baseline.sql', import.meta.url), 'utf8'));
  const inventory = results.find(r => r.fields?.some(f => f.name === 'rank_band')).rows;
  const stories = results.find(r => r.fields?.some(f => f.name === 'captured_at_utc')).rows;
  const bands = Object.fromEntries(inventory.map(r => [r.rank_band, r]));
  assert.equal(stories.length, 8);
  assert.equal(Number(bands['001-010'].usable_briefs), 1);
  assert.equal(Number(bands['011-050'].initial_summary_backlog_with_source), 1);
  const pending = stories.find(r => Number(r.hn_id) === 2);
  const expectedAge = (new Date(pending.captured_at_utc) - new Date(pending.date_added)) / 3_600_000;
  assert.ok(Math.abs(Number(bands['011-050'].initial_summary_backlog_age_p50_hours) - expectedAge) < 1 / 3_600_000);
  assert.equal(Number(bands['051-100'].initial_summary_backlog_with_source), 0);
  assert.equal(Number(bands['051-100'].initial_summary_backlog_without_source), 1);
  assert.equal(Number(bands['051-100'].existing_summary_needs_repair), 3);
  assert.equal(bands['051-100'].initial_summary_backlog_age_p50_hours, null);
  assert.equal(Number(bands['101+'].existing_summary_needs_repair), 1);
  assert.equal(Number(bands['101+'].usable_briefs), 1);
  for (const row of inventory) {
    assert.equal(Number(row.eligible_sources), Number(row.usable_briefs)
      + Number(row.initial_summary_backlog_with_source)
      + Number(row.initial_summary_backlog_without_source)
      + Number(row.existing_summary_needs_repair));
  }
  for (const id of [4,5,6]) {
    const row = stories.find(r => Number(r.hn_id) === id);
    assert.equal(row.has_summary, true);
    assert.equal(row.ready, false);
    assert.equal(row.source_retained, true);
  }
  console.log('PASS: baseline inventory partitions and readiness snapshots (8 cases)');
} finally {
  await db.close();
}

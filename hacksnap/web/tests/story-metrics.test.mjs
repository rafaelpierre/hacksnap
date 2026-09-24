import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { storyMetricsSQL, storyMetrics, storyMetricsText } from '../lib/story-metrics.ts';
import { storyMarkdown } from '../lib/markdown.ts';

test('retained ranking metrics survive the 24h window, isolate stories and do not count unobserved time', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE hacksnap_rank_history(hn_id bigint, observed_at timestamptz, rank bigint,
      PRIMARY KEY (hn_id, observed_at));
      INSERT INTO hacksnap_rank_history VALUES
      (1, '2020-01-01T00:00Z', 8), (1, '2020-01-01T04:00Z', 3),
      (1, '2020-01-01T08:00Z', 12), (1, '2020-01-01T12:00Z', 2),
      (1, '2020-01-03T00:00Z', 20), (1, CURRENT_TIMESTAMP + interval '1 hour', 1),
      (2, '2020-01-01T00:00Z', 1),
      (4, '2020-01-01T00:00Z', 11), (4, '2020-01-01T04:00Z', 12),
      (5, '2020-01-01T00:00Z', 1), (5, '2020-01-03T00:00Z', 2),
      (6, '2020-01-01T20:00Z', 1), (6, '2020-01-02T08:05Z', 2);`);
    const {rows} = await db.query(`SELECT ${storyMetricsSQL} AS metrics FROM (VALUES (1),(2),(3),(4),(5),(6)) t(hn_id) ORDER BY t.hn_id`);
    assert.equal(rows[0].metrics.peak_rank, 2);
    assert.equal(rows[0].metrics.observation_count, 5);
    assert.equal(rows[0].metrics.top_ten_hours, 8);
    assert.deepEqual(rows[0].metrics.history.map(p => p.rank), [8, 3, 12, 2, 20]);
    assert.equal(Date.parse(rows[0].metrics.first_observed_at), Date.parse('2020-01-01T00:00Z'));
    assert.equal(Date.parse(rows[0].metrics.last_observed_at), Date.parse('2020-01-03T00:00Z'));
    assert.equal(rows[1].metrics.peak_rank, 1);
    assert.equal(rows[1].metrics.top_ten_hours, null, 'one observation cannot establish duration');
    assert.deepEqual(rows[2].metrics, {peak_rank: null, observation_count: 0, first_observed_at: null,
      last_observed_at: null, top_ten_hours: null, history: []});
    assert.equal(rows[3].metrics.top_ten_hours, 0, 'outside Top 10 throughout measured intervals');
    assert.equal(rows[4].metrics.top_ten_hours, null, 'long gaps cannot establish duration');
    assert.ok(Math.abs(rows[5].metrics.top_ten_hours - (12 + 5 / 60)) < 0.00001, 'normal overnight collection gap is measured');
  } finally { await db.close(); }
});

test('chart is bounded while peak and duration use every retained observation', async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE hacksnap_rank_history(hn_id bigint, observed_at timestamptz, rank bigint,
      PRIMARY KEY (hn_id, observed_at));
      INSERT INTO hacksnap_rank_history
      SELECT 1, '2020-01-01T00:00Z'::timestamptz + n * interval '1 hour', CASE WHEN n = 0 THEN 1 ELSE 5 END
      FROM generate_series(0,200) n;`);
    const {rows: [{metrics}]} = await db.query(`SELECT ${storyMetricsSQL} AS metrics FROM (VALUES (1)) t(hn_id)`);
    assert.equal(metrics.peak_rank, 1);
    assert.equal(metrics.observation_count, 201);
    assert.equal(metrics.top_ten_hours, 200);
    assert.equal(metrics.history.length, 168);
    assert.equal(metrics.history[0].rank, 5);
    assert.ok(metrics.history.every((p, i, a) => !i || Date.parse(p.observed_at) > Date.parse(a[i-1].observed_at)));
  } finally { await db.close(); }
});

const story = {
  hn_id: '123', title: 'Example', url: 'https://example.com', points: 60, comment_count: 200,
  date_added: new Date('2020-01-01T00:00Z'), observed_at: '2026-09-24T00:00Z',
  summary: {sentiment: -1, overall_takeaway: 'Takeaway', article_summary: 'Brief', article_key_points: [],
    discussion_summary: 'Discussion', discussion_points: [], generated_at: '2020-01-01T00:00Z', model: 'test',
    source_coverage: {included_comments: 17, stored_comments: 40, article_status: 'fetched', sentiment: {included_comments: 10}}},
  ranking_metrics: {peak_rank: 3, observation_count: 2, top_ten_hours: 7.9,
    first_observed_at: '2020-01-01T00:00Z', last_observed_at: '2020-01-01T08:00Z',
    history: [{observed_at: '2020-01-01T00:00Z', rank: 3}, {observed_at: '2020-01-01T08:00Z', rank: 12}]},
};

test('skepticism stays categorical and identifies its separate sample from summary coverage', () => {
  const metrics = storyMetrics(story);
  assert.equal(metrics.skepticism, 'High');
  assert.equal(metrics.comments, '17 comments');
  assert.match(metrics.skepticismNote, /10 comments/);
  assert.equal(metrics.peak, '#3');
  assert.equal(metrics.topTen, '7.9 hours');
  const legacy = storyMetrics({...story, summary: {...story.summary,
    source_coverage: {...story.summary.source_coverage, sentiment: undefined}}});
  assert.match(legacy.skepticismNote, /sampled comments/);
  assert.doesNotMatch(legacy.skepticismNote, /17/);
  assert.equal(storyMetrics({...story, summary: null}).skepticism, 'Pending');
  assert.equal(storyMetrics({...story, summary: null}).comments, 'Analysis pending');
  assert.equal(storyMetrics({...story, summary: {...story.summary, sentiment: null,
    source_coverage: {...story.summary.source_coverage, sentiment: {included_comments: 0}}}}).skepticism, 'No comments');
  assert.equal(storyMetrics({...story, ranking_metrics: undefined}).topTen, 'Not enough history');
});

test('story Markdown includes the same persistent metrics and historical chart observations', () => {
  const plain = storyMarkdown(story).replace(/\\([\\`*_{}\[\]<>#+.!|~-])/g, '$1');
  for (const value of ['Skept-o-meter: High', '17 comments', '10 comments',
    'Peak rank: #3', 'Time in Top 10: 7.9 hours',
    '2020-01-01T00:00Z: rank #3', 'gaps over 13 hours']) assert.ok(plain.includes(value), value);
  assert.doesNotMatch(storyMetricsText(story).join('\n'), /Peak HN rank|\d+\/100/);
});

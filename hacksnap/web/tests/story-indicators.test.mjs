import assert from 'node:assert/strict';
import { test } from 'node:test';
import { storyIndicators } from '../lib/story-indicators.ts';
import { leaderboardMarkdown, storyMarkdown } from '../lib/markdown.ts';
import { renderRSS } from '../lib/rss.ts';
import { sitemapEntries } from '../lib/sitemap.ts';

const asOf = '2026-09-20T12:00:00Z';
const story = {
  hn_id: '123', title: 'Example', url: 'https://example.com', points: 65, comment_count: 12,
  date_added: new Date(asOf), observed_at: asOf,
  activity_history: [
    {observed_at: '2026-09-20T09:00:00Z', score: 20},
    {observed_at: '2026-09-20T10:00:00Z', score: 60},
    {observed_at: '2026-09-20T11:00:00Z', score: 65},
  ],
  summary: {
    sentiment: 1, overall_takeaway: 'Takeaway', article_summary: 'Brief', article_key_points: [],
    discussion_summary: 'Discussion', discussion_points: [], generated_at: asOf, model: 'test',
    source_coverage: {included_comments: 8, stored_comments: 10, article_status: 'fetched'},
  },
};

test('Markdown and RSS expose sentiment, measured history and slowing hotness consistently', () => {
  const outputs = [leaderboardMarkdown({stories: [story], ingestion: new Date(asOf), observed_at: asOf}),
    storyMarkdown(story), renderRSS([story], asOf)];
  for (const output of outputs) {
    const plain = output.replace(/\\([\\`*_{}\[\]<>#+.!|~-])/g, '$1');
    for (const value of ['65 points', '12 comments', 'Sentiment: Excited (+1)', 'Hotness (past 24h',
      '−35 points/hour change', '+40 points/hour', '+5 points/hour', '2026-09-20T11:00:00.000Z']) {
      assert.ok(plain.includes(value), value);
    }
  }
});

test('sentiment distinguishes neutral, skeptical, pending, and no comments', () => {
  for (const [sentiment, label] of [[-1, 'Skeptical (-1)'], [0, 'Neutral (0)'], [1, 'Excited (+1)'], [null, 'Pending']]) {
    assert.ok(storyIndicators({...story, summary: {...story.summary, sentiment}}, asOf)[0].includes(label));
  }
  assert.match(storyIndicators({...story, summary: null}, asOf)[0], /Pending/);
  assert.match(storyIndicators({...story, summary: {...story.summary, sentiment: null,
    source_coverage: {included_comments: 0}}}, asOf)[0], /No comments/);
});

test('missing or expired history is unknown and one interval cannot establish a trend', () => {
  for (const activity_history of [undefined, [], story.activity_history.slice(0, 1)]) {
    assert.match(storyIndicators({...story, activity_history}, asOf).join('\n'), /Collecting history/);
  }
  assert.match(storyIndicators(story, '2026-09-22T12:00:00Z').join('\n'), /Collecting history/);
  const one = storyIndicators({...story, activity_history: story.activity_history.slice(0, 2)}, asOf).join('\n');
  assert.match(one, /Not enough history to measure a change/);
  assert.match(one, /\+40 points\/hour/);
});

test('sitemap exposes latest content modification on homepage and keeps each story timestamp', () => {
  const older = new Date('2026-09-19T12:00:00Z');
  const latest = new Date(asOf);
  const entries = sitemapEntries([{hn_id: '123', modified_at: latest}, {hn_id: '456', modified_at: older}]);
  assert.equal(entries[0].lastModified, latest);
  assert.equal(entries[1].lastModified, latest);
  assert.equal(entries[2].lastModified, older);
  assert.equal(entries[1].url, 'https://hacksnap.live/story/123');
  assert.deepEqual(sitemapEntries([]), [{url: 'https://hacksnap.live/'}]);
});

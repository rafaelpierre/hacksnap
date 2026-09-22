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
  rank_history: [
    {observed_at: '2026-09-20T09:00:00Z', rank: 8},
    {observed_at: '2026-09-20T10:00:00Z', rank: 4},
    {observed_at: '2026-09-20T11:00:00Z', rank: 2},
  ],
  summary: {
    sentiment: 1, overall_takeaway: 'Takeaway', article_summary: 'Brief', article_key_points: [],
    discussion_summary: 'Discussion', discussion_points: [], generated_at: asOf, model: 'test',
    source_coverage: {included_comments: 8, stored_comments: 10, article_status: 'fetched'},
  },
};

test('Markdown and RSS expose sentiment, rank history and climbing hotness consistently', () => {
  const outputs = [leaderboardMarkdown({stories: [story], ingestion: new Date(asOf), observed_at: asOf}),
    storyMarkdown(story), renderRSS([story], asOf)];
  for (const output of outputs) {
    const plain = output.replace(/\\([\\`*_{}\[\]<>#+.!|~-])/g, '$1');
    for (const value of ['65 points', '12 comments', 'Sentiment: Excited (+1)', 'Hotness (past 24h',
      '+6 places changed', 'rank #8', 'rank #2', '2026-09-20T11:00:00.000Z']) {
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

test('missing or expired history is unknown and one observation cannot establish a trend', () => {
  for (const rank_history of [undefined, []]) {
    assert.match(storyIndicators({...story, rank_history}, asOf).join('\n'), /Collecting history/);
  }
  assert.match(storyIndicators(story, '2026-09-22T12:00:00Z').join('\n'), /Collecting history/);
  const one = storyIndicators({...story, rank_history: story.rank_history.slice(0, 1)}, asOf).join('\n');
  assert.match(one, /Not enough history to measure a change/);
  assert.match(one, /rank #8/);
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


test('text formats include the current displayed rank and handle unranked stories', () => {
  const ranked = storyIndicators({...story, rank: '1'}, asOf).join('\n');
  assert.match(ranked, /\+7 places changed/);
  assert.match(ranked, /2026-09-20T12:00:00.000Z: rank #1/);
  assert.doesNotMatch(storyIndicators({...story, rank: null}, asOf).join('\n'), /rank #0/);
});

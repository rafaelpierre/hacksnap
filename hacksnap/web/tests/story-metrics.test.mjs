import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { storyMetrics, storyMetricsText, storyMetricsSQL } from "../lib/story-metrics.ts";
import { PGlite } from "@electric-sql/pglite";
import { storyMarkdown } from "../lib/markdown.ts";

const story = {
  hn_id: "123",
  title: "Example",
  url: "https://example.com",
  points: 60,
  comment_count: 200,
  date_added: new Date("2020-01-01T00:00Z"),
  observed_at: "2026-09-24T00:00Z",
  summary: {
    sentiment: -1,
    overall_takeaway: "Takeaway",
    article_summary: "Brief",
    article_key_points: [],
    discussion_summary: "Discussion",
    discussion_points: [],
    generated_at: "2020-01-01T00:00Z",
    model: "test",
    source_coverage: {
      included_comments: 17,
      stored_comments: 40,
      article_status: "fetched",
      sentiment: { included_comments: 10 },
    },
  },
  ranking_metrics: {
    peak_rank: 3,
    observation_count: 2,
    top_ten_hours: 7.9,
    first_observed_at: "2020-01-01T00:00Z",
    last_observed_at: "2020-01-01T08:00Z",
    history: [
      { observed_at: "2020-01-01T00:00Z", rank: 3 },
      { observed_at: "2020-01-01T08:00Z", rank: 12 },
    ],
  },
};

test("skepticism stays categorical and identifies its separate sample from summary coverage", () => {
  const metrics = storyMetrics(story);
  assert.equal(metrics.skepticism, "High");
  assert.equal(metrics.comments, "17 comments");
  assert.match(metrics.skepticismNote, /10 comments/);
  assert.equal(metrics.peak, "#3");
  assert.equal(metrics.topTen, "7.9 hours");
  const legacy = storyMetrics({
    ...story,
    summary: {
      ...story.summary,
      source_coverage: { ...story.summary.source_coverage, sentiment: undefined },
    },
  });
  assert.match(legacy.skepticismNote, /sampled comments/);
  assert.doesNotMatch(legacy.skepticismNote, /17/);
  assert.equal(storyMetrics({ ...story, summary: null }).skepticism, "Pending");
  assert.equal(storyMetrics({ ...story, summary: null }).comments, "Analysis pending");
  assert.equal(
    storyMetrics({
      ...story,
      summary: {
        ...story.summary,
        sentiment: null,
        source_coverage: { ...story.summary.source_coverage, sentiment: { included_comments: 0 } },
      },
    }).skepticism,
    "No comments",
  );
  assert.equal(storyMetrics({ ...story, ranking_metrics: undefined }).topTen, "Not enough history");
});

test("story Markdown includes the same persistent metrics and historical chart observations", () => {
  const plain = storyMarkdown(story).replace(/\\([\\`*_{}[\]<>#+.!|~-])/g, "$1");
  for (const value of [
    "Skept-o-meter: High",
    "17 comments",
    "10 comments",
    "Peak rank: #3",
    "Time in Top 10: 7.9 hours",
    "2020-01-01T00:00Z: rank #3",
    "gaps over 14 hours",
  ])
    assert.ok(plain.includes(value), value);
  assert.doesNotMatch(storyMetricsText(story).join("\n"), /Peak HN rank|\d+\/100/);
});

test("ranking duration includes fall-back runtime slack but rejects gaps over 14 hours", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE hacksnap_rank_history (
      hn_id bigint, observed_at timestamptz, rank integer,
      PRIMARY KEY (hn_id, observed_at)
    )`);
    // 8 PM EDT to 8 AM EST is 13 elapsed hours; the morning refresh ends later.
    for (const [id, morning, hours] of [
      [1, "2025-11-02T08:30:00-05:00", 13.5],
      [2, "2025-11-02T09:00:00-05:00", 14],
      [3, "2025-11-02T09:00:01-05:00", null],
    ]) {
      await db.query(
        `INSERT INTO hacksnap_rank_history VALUES
          ($1, '2025-11-01T20:00:00-04:00', 3), ($1, $2, 12)`,
        [id, morning],
      );
      const { rows } = await db.query(
        `SELECT ${storyMetricsSQL} AS metrics FROM (VALUES ($1::bigint)) AS t(hn_id)`,
        [id],
      );
      assert.equal(rows[0].metrics.top_ten_hours, hours);
      assert.equal(rows[0].metrics.observation_count, 2);
    }
  } finally {
    await db.close();
  }
});

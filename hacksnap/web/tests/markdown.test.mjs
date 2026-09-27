import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  acceptsMarkdown,
  leaderboardMarkdown,
  storyMarkdown,
  markdownResponse,
} from "../lib/markdown.ts";

test("negotiation requires explicit acceptable Markdown and respects HTML preferences", () => {
  for (const header of [
    null,
    "",
    "*/*",
    "text/*",
    "text/html",
    "text/markdown;q=0",
    "text/markdown;q=bogus",
    "text/markdown;q=2",
    "text/markdown;q=0.5,text/html",
    "application/text/markdown",
    "text/markdown-extra",
  ]) {
    assert.equal(acceptsMarkdown(header), false, String(header));
  }
  for (const header of [
    "text/markdown",
    "TEXT/MARKDOWN; charset=utf-8",
    "text/markdown,text/html",
    "text/html;q=0.5, text/markdown;q=0.9",
    "text/markdown,*/*;q=0.8",
  ]) {
    assert.equal(acceptsMarkdown(header), true, header);
  }
});

const story = {
  hn_id: "123",
  title: "Example [story] <script>",
  url: "https://example.com/a(b)",
  points: 42,
  comment_count: 12,
  rank: "1",
  is_recent: true,
  date_added: new Date("2026-09-19T12:00:00Z"),
  summary: {
    overall_takeaway: "The takeaway",
    article_summary: "The article brief",
    article_key_points: ["First point"],
    discussion_summary: "The discussion",
    discussion_points: [{ title: "A disagreement", summary: "Some context", comment_ids: [456] }],
    generated_at: "2026-09-19T12:00:00Z",
    model: "test-model",
    source_coverage: {
      included_comments: 8,
      stored_comments: 10,
      comments_truncated: true,
      article_status: "fetched",
    },
  },
  internal_diagnostics: "never expose this",
};

test("story Markdown preserves public content, citations and coverage without HTML", () => {
  const body = storyMarkdown(story);
  for (const value of [
    "The takeaway",
    "The article brief",
    "First point",
    "The discussion",
    "Some context",
    "item?id=456",
    "8 of 10",
    "further shortened",
    "AI-generated summary",
  ])
    assert.ok(body.includes(value), value);
  assert.ok(body.includes("[Read original](<https://example.com/a(b)>)"));
  assert.ok(body.includes("Example \\[story\\] \\<script\\>"));
  assert.ok(!body.includes("internal_diagnostics"));
  assert.ok(!body.includes("never expose this"));
  assert.ok(!body.includes("<script>"));
});

test("pending and unavailable sources remain explicit; unsafe article URLs are omitted", () => {
  const pending = storyMarkdown({ ...story, summary: null, url: "javascript:alert(1)" });
  assert.match(pending, /Summary pending/);
  assert.ok(!pending.includes("javascript:"));
  const unavailable = storyMarkdown({
    ...story,
    summary: {
      ...story.summary,
      article_summary: null,
      source_coverage: { ...story.summary.source_coverage, article_status: "unavailable" },
    },
  });
  assert.match(unavailable, /couldn’t be retrieved/);
});

test("leaderboard preserves order, links, freshness and empty states", () => {
  const body = leaderboardMarkdown({
    stories: [story, { ...story, hn_id: "124", rank: "2" }],
    ingestion: new Date(0),
  });
  assert.ok(body.indexOf("/story/123") < body.indexOf("/story/124"));
  assert.match(body, /Updates are delayed/);
  assert.match(body, /Top stories \(2\)/);
  assert.match(body, /The takeaway/);
  assert.match(leaderboardMarkdown({ stories: [], ingestion: null }), /No stories yet/);
});

test("Markdown homepage excludes pending and blank takeaways from entries and counts", () => {
  const pending = [
    { ...story, hn_id: "124", summary: null },
    { ...story, hn_id: "125", summary: { ...story.summary, overall_takeaway: "" } },
    { ...story, hn_id: "126", summary: { ...story.summary, overall_takeaway: " \n\t " } },
  ];
  const body = leaderboardMarkdown({
    stories: [pending[0], story, ...pending.slice(1)],
    ingestion: null,
  });
  assert.match(body, /Top stories \(1\)/);
  assert.match(body, /\/story\/123/);
  assert.doesNotMatch(body, /\/story\/(124|125|126)|Summary pending/);
  const empty = leaderboardMarkdown({ stories: pending, ingestion: null });
  assert.match(empty, /Top stories \(0\)/);
  assert.match(empty, /No stories yet/);
  assert.doesNotMatch(empty, /###|Summary pending/);
});

test("Markdown responses identify their representation and vary on Accept", async () => {
  const response = markdownResponse("# Example\n");
  assert.equal(response.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(response.headers.get("vary"), "Accept");
  assert.equal(await response.text(), "# Example\n");
  const unavailable = markdownResponse("# Unavailable\n", 503);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get("cache-control"), "no-store");
  assert.equal(unavailable.headers.get("retry-after"), "60");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

const analysisFixtures = JSON.parse(
  readFileSync(new URL("../../fixtures/discussion-analysis/valid.json", import.meta.url)),
);
const analysisStory = (analysis) => ({
  ...story,
  summary: {
    ...story.summary,
    discussion_analysis: analysis,
    discussion_analyzed_at: "2026-09-27T09:00:00Z",
    discussion_analysis_coverage: {
      included_comments: 2,
      stored_comments: 7,
      comments_truncated: true,
      selection_method: "active_branches_with_ancestors_v1",
    },
  },
});

test.each(analysisFixtures)(
  "Markdown exports cited analysis and limitations: $id",
  ({ expected }) => {
    const body = storyMarkdown(analysisStory(expected));
    assert.match(body, /2 of 7 usable stored comments/);
    assert.match(body, /active discussion branches/i);
    assert.match(body, /parent comments/);
    assert.match(body, /further shortened/);
    assert.match(body, /do not measure community opinion/);
    assert.match(body, /Analyzed: 2026\\-09\\-27T09:00:00Z/);
    assert.doesNotMatch(body, /Some context|A disagreement/);
    for (const topic of expected.topics) {
      assert.ok(body.includes(topic.title.replaceAll("-", "\\-")));
      for (const id of topic.comment_ids)
        assert.ok(body.includes(`[Comment ${id}](<https://news.ycombinator.com/item?id=${id}>)`));
    }
    for (const highlight of [...expected.critical_comments, ...expected.supportive_comments]) {
      assert.ok(
        body.includes(
          `[Comment ${highlight.comment_id}](<https://news.ycombinator.com/item?id=${highlight.comment_id}>)`,
        ),
      );
      assert.match(body, /Claim addressed/);
      assert.ok(body.includes(highlight.paraphrase.replace(/([\\`*_{}[\]<>#+.!|~-])/g, "\\$1")));
      assert.ok(body.includes(highlight.explanation.replace(/([\\`*_{}[\]<>#+.!|~-])/g, "\\$1")));
    }
    if (expected.status === "no_comments") assert.match(body, /No usable comments were available/);
    if (expected.status === "insufficient_context")
      assert.match(body, /did not contain a clear claim/);
    if (expected.status === "available") {
      assert.match(body, /text below is paraphrased/);
      for (const kind of ["critical", "supportive"])
        if (!expected[`${kind}_comments`].length)
          assert.ok(body.includes(`No clear ${kind} examples in the analyzed comments`));
    }
  },
);

test("Markdown preserves legacy content when analysis is absent or null", () => {
  assert.equal(storyMarkdown(analysisStory(null)).includes("Some context"), true);
  assert.equal(storyMarkdown(story).includes("Some context"), true);
  assert.doesNotMatch(storyMarkdown(analysisStory(null)), /Discussion analysis|Analyzed:/);
});

test("Markdown escapes all analysis text, keeps qualifications and excludes private metadata", () => {
  const analysis = structuredClone(
    analysisFixtures.find((fixture) => fixture.id === "qualified_agreement").expected,
  );
  const hostile = "<script> [fake](javascript:alert(1))\n# injected *bold*";
  analysis.reference_claims[0].text = hostile;
  analysis.supportive_comments[0].paraphrase = hostile;
  analysis.supportive_comments[0].explanation = hostile;
  analysis.topics[0].title = hostile;
  analysis.topics[0].summary = hostile;
  analysis.raw_payload = "private-marker";
  const row = analysisStory(analysis);
  row.summary.discussion_analysis_meta = { model: "private-marker" };
  row.summary.discussion_analysis_coverage.comments_fingerprint = "private-marker";
  const body = storyMarkdown(row);
  assert.doesNotMatch(body, /<script>|\[fake\]\(javascript:|\n# injected|private-marker/);
  assert.ok(body.includes("\\<script\\> \\[fake\\](javascript:alert(1))\n\\# injected \\*bold\\*"));
  assert.match(body, /Agrees with reservations/);
  assert.match(body, /item\?id=106/);
  row.summary.discussion_analyzed_at = null;
  row.summary.discussion_analysis_coverage = null;
  const unknown = storyMarkdown(row);
  assert.match(unknown, /Analysis time unavailable/);
  assert.match(unknown, /Analyzed-comment count unavailable/);
});

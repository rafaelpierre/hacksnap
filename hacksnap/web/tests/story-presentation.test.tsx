import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "@jest/globals";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { StoryContent } from "../app/story/[id]/story-content";
import { storyPreviewMetadata } from "../lib/preview-metadata";
import { storyMarkdown } from "../lib/markdown";
import type { Story, DiscussionAnalysis } from "../lib/data";

const analysisFixtures: { id: string; expected: DiscussionAnalysis }[] = JSON.parse(
  readFileSync(new URL("../../fixtures/discussion-analysis/valid.json", import.meta.url), "utf8"),
);

const base: Story = {
  hn_id: "146",
  title: "A source <script>",
  url: "https://example.com/article",
  category: null,
  points: 4,
  comment_count: 40,
  date_added: new Date("2026-09-30T10:00:00Z"),
  summary: {
    article_summary: "An article brief.",
    article_key_points: [],
    discussion_summary: "Older discussion summary.",
    discussion_points: [{ title: "Old topic", summary: "Older point.", comment_ids: [1] }],
    sentiment: 0,
    overall_takeaway: "A practical takeaway.",
    generated_at: "2026-09-30T10:00:00Z",
    model: "fixture",
    source_coverage: {
      included_comments: 2,
      stored_comments: 8,
      comments_truncated: false,
      article_status: "fetched",
    },
  },
};

function formats(story: Story) {
  const html = renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: {} as never },
      createElement(StoryContent, { story, relatedStories: [] }),
    ),
  );
  return {
    html,
    markdown: storyMarkdown(story),
    description: storyPreviewMetadata(story).description as string,
  };
}

test("pending and legacy states agree across HTML, metadata and Markdown", () => {
  const pending = formats({ ...base, summary: null });
  for (const value of Object.values(pending)) assert.match(value, /pending/i);

  const legacy = formats(base);
  for (const value of Object.values(legacy)) {
    assert.match(value, /Old topic/);
    assert.doesNotMatch(value, /New topic/);
  }
  assert.match(legacy.description, /2 sampled comments/);
  assert.match(legacy.markdown, /Based on 2 of 8/);
});

test.each(analysisFixtures)(
  "active $id analysis displaces stale topics in every format",
  ({ expected }) => {
    const current: Story = {
      ...base,
      summary: {
        ...base.summary!,
        discussion_analysis: {
          ...expected,
          topics:
            expected.status === "no_comments"
              ? []
              : [{ key: "other", title: "New topic", summary: "New point.", comment_ids: [2] }],
        },
        discussion_analysis_coverage: {
          included_comments: expected.status === "no_comments" ? 0 : 15,
          stored_comments: 30,
          comments_truncated: false,
          selection_method: "active_branches_with_ancestors_v1",
        },
        discussion_analyzed_at: "2026-10-01T09:00:00Z",
      },
    };
    const { html, markdown, description } = formats(current);
    for (const value of [html, markdown, description]) assert.doesNotMatch(value, /Old topic/);
    if (expected.status === "no_comments") {
      for (const value of [html, markdown, description])
        assert.doesNotMatch(value, /Older discussion summary/);
      assert.match(description, /No usable Hacker News comments/);
    } else {
      for (const value of [html, markdown, description]) assert.match(value, /New topic/);
      assert.match(description, /15 sampled comments/);
      assert.doesNotMatch(html, /Legacy summary sample|Older discussion summary/);
    }
    assert.match(markdown, /Analysis sample: Based on (0|15) of 30/);
    assert.match(markdown, /Based on 2 of 8/);
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(markdown, /<script>/);
  },
);

test("missing external brief remains an article across HTML and Markdown", () => {
  for (const article_status of ["fetched", "not_applicable"] as const) {
    const row: Story = {
      ...base,
      summary: {
        ...base.summary!,
        article_summary: null,
        source_coverage: { ...base.summary!.source_coverage, article_status },
      },
    };
    const { html, markdown } = formats(row);
    assert.match(html, /No article brief is available/);
    assert.match(markdown, /No article brief is available/);
    assert.match(markdown, /Read original/);
    assert.doesNotMatch(markdown, /HN text post/);
  }
});

test("legacy discussion with no usable introduction does not advertise stale topics", () => {
  const row: Story = {
    ...base,
    summary: {
      ...base.summary!,
      discussion_summary: "",
      discussion_points: base.summary!.discussion_points,
    },
  };
  const { html, markdown, description } = formats(row);
  for (const value of [html, markdown, description]) {
    assert.doesNotMatch(value, /Old topic/);
    assert.match(value, /No usable discussion/);
  }
});

import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { previewText, storyPreviewMetadata } from "../lib/preview-metadata.ts";

function summary(overrides = {}) {
  return {
    article_summary: "The article describes an AGENTS.md issue in Claude Code.",
    overall_takeaway: "The discussion examines the behavior and its rollout.",
    discussion_summary: "The discussion examines the rollout.",
    discussion_points: [
      { title: "Anthropic's response", summary: "Response", comment_ids: [101] },
      { title: "Feature-flag debate", summary: "Debate", comment_ids: [102] },
      { title: "Criticism", summary: "Criticism", comment_ids: [103] },
    ],
    source_coverage: {
      included_comments: 17,
      stored_comments: 80,
      comments_truncated: true,
      article_status: "fetched",
    },
    ...overrides,
  };
}

test("long stories get compact previews without changing the source title or image alt", () => {
  const title = "Kev: Tiny Jev-like family of decision models built on top of Qwen3.5";
  const story = {
    hn_id: "49783999",
    title,
    summary: summary({
      discussion_points: [
        {
          title: "Practical tradeoffs in speed, model size, training data and accuracy. ".repeat(3),
        },
      ],
    }),
  };
  const metadata = storyPreviewMetadata(story);
  assert.ok(Array.from(metadata.title.absolute).length <= 71);
  assert.ok(Array.from(metadata.openGraph.title).length <= 60);
  assert.match(metadata.title.absolute, /… \| Hacksnap$/);
  assert.match(metadata.openGraph.title, /…$/);
  assert.equal(metadata.twitter.title, metadata.openGraph.title);
  assert.ok(Array.from(metadata.description).length <= 155);
  assert.ok(Array.from(metadata.openGraph.description).length <= 125);
  assert.equal(metadata.twitter.description, metadata.openGraph.description);
  assert.equal(metadata.openGraph.siteName, "Hacksnap");
  assert.equal(metadata.twitter.card, "summary_large_image");
  assert.equal(metadata.twitter.images[0].alt, title);
  assert.equal(story.title, title);
  assert.equal(metadata.alternates.canonical, "https://hacksnap.live/story/49783999");
  assert.deepEqual(metadata.openGraph.images, [
    {
      url: "https://hacksnap.live/story/49783999/opengraph-image",
      alt: title,
      width: 1200,
      height: 630,
    },
  ]);
  assert.deepEqual(metadata.twitter.images, metadata.openGraph.images);
});

test("search and social titles use the headline while descriptions retain the actual sample and topics", () => {
  const metadata = storyPreviewMetadata({
    hn_id: "1",
    title: "Claude Code AGENTS.md issue",
    comment_count: 240,
    summary: summary(),
  });
  assert.equal(metadata.title.absolute, "Claude Code AGENTS.md issue | Hacksnap");
  assert.equal(metadata.openGraph.title, "Claude Code AGENTS.md issue");
  assert.equal(metadata.twitter.title, "Claude Code AGENTS.md issue");
  assert.equal(
    metadata.description,
    "Article summary and Hacker News reactions from 17 sampled comments. Topics: Anthropic's response; Feature-flag debate; Criticism",
  );
  assert.equal(
    metadata.twitter.description,
    "Article summary and Hacker News reactions from 17 sampled comments. Topics: Anthropic's response; Feature-flag debate…",
  );
  assert.equal(metadata.robots.index, true);
});

test("pending summaries describe their state and remain excluded from indexing", () => {
  const metadata = storyPreviewMetadata({ hn_id: "1", title: "Small models", summary: null });
  assert.equal(metadata.title.absolute, "Small models | Hacksnap");
  assert.equal(
    metadata.description,
    "Article and Hacker News reaction summary pending. Follow the links to the original source and full discussion on Hacksnap.",
  );
  assert.deepEqual(metadata.robots, { index: false, follow: true });
});

test.each([null, undefined, "", " ", "\n\t\r "])(
  "stored summaries with unpublished takeaway %j stay noindex without changing canonical or social metadata",
  (overall_takeaway) => {
    const story = {
      hn_id: "1",
      story_slug: "small-models-1",
      title: "Small models",
      summary: summary(),
    };
    const published = storyPreviewMetadata(story);
    const pending = storyPreviewMetadata({ ...story, summary: summary({ overall_takeaway }) });
    assert.deepEqual(pending.robots, { index: false, follow: true });
    assert.deepEqual({ ...pending, robots: published.robots }, published);
    assert.equal(pending.alternates.canonical, "https://hacksnap.live/story/small-models-1");
    assert.equal(
      pending.openGraph.images[0].url,
      "https://hacksnap.live/story/small-models-1/opengraph-image",
    );
    assert.deepEqual(pending.twitter.images, pending.openGraph.images);
  },
);

test("a published takeaway surrounded by whitespace stays indexed", () => {
  const metadata = storyPreviewMetadata({
    hn_id: "1",
    title: "Small models",
    summary: summary({ overall_takeaway: " \n Published takeaway. \t " }),
  });
  assert.deepEqual(metadata.robots, { index: true, follow: true });
});

test("discussion-only pages do not promise an article summary", () => {
  for (const article_status of ["unavailable", "not_applicable"]) {
    const metadata = storyPreviewMetadata({
      hn_id: "1",
      title: "Small models",
      summary: summary({
        article_summary: null,
        source_coverage: {
          included_comments: 1,
          stored_comments: 80,
          comments_truncated: true,
          article_status,
        },
      }),
    });
    assert.match(metadata.description, /^Hacker News reactions from 1 sampled comment\. Topics:/);
    for (const description of [
      metadata.description,
      metadata.openGraph.description,
      metadata.twitter.description,
    ]) {
      assert.doesNotMatch(description, /[Aa]rticle summary/);
    }
    assert.equal(metadata.robots.index, true);
  }
});

test("zero-comment samples do not imply a discussion was summarized or that the whole thread is empty", () => {
  const metadata = storyPreviewMetadata({
    hn_id: "1",
    title: "Small models",
    comment_count: 240,
    summary: summary({
      source_coverage: {
        included_comments: 0,
        stored_comments: 80,
        comments_truncated: true,
        article_status: "fetched",
      },
      discussion_points: [],
      overall_takeaway: "A practical model.",
    }),
  });
  assert.equal(
    metadata.description,
    "Article summary. No Hacker News comments were included in this summary. A practical model.",
  );
});

test("missing discussion topics fall back to the takeaway while retaining reaction coverage", () => {
  const metadata = storyPreviewMetadata({
    hn_id: "1",
    title: "Small models",
    summary: summary({
      discussion_points: [{ title: "   " }],
      overall_takeaway: "  A practical\n model. ",
    }),
  });
  assert.equal(
    metadata.description,
    "Article summary and Hacker News reactions from 17 sampled comments. A practical model.",
  );
});

test("preview clipping normalizes whitespace, respects words and preserves Unicode code points", () => {
  assert.equal(previewText("  One\n two  ", 10), "One two");
  assert.equal(previewText("Alpha beta gamma", 11), "Alpha beta…");
  assert.equal(previewText("Alpha beta gamma", 9), "Alpha…");
  assert.equal(previewText("😀".repeat(20), 5), "😀😀😀😀…");
  assert.equal(previewText("A".repeat(20), 5), "AAAA…");
});

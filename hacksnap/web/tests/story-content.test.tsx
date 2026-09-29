import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DiscussionAnalysis } from "../lib/discussion-analysis";
import { test } from "@jest/globals";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { StoryContent } from "../app/story/[id]/story-content";
import { StoryRow } from "../app/story-row";
import { BrowseLayout } from "../app/topic-sidebar";
import type { Story, RelatedStory } from "../lib/data";

const story: Story = {
  hn_id: "90000001",
  title: "A mocked story title",
  category: "agents_coding",
  url: "https://example.com/article",
  points: 42,
  comment_count: 12,
  date_added: new Date("2026-09-26T10:00:00Z"),
  summary: {
    article_summary: "The mocked article brief.",
    article_key_points: ["A concrete point."],
    discussion_summary: "The mocked discussion brief.",
    discussion_points: [],
    sentiment: 0,
    overall_takeaway: "A test takeaway.",
    generated_at: "2026-09-26T10:00:00Z",
    model: "test",
    source_coverage: {
      stored_comments: 12,
      included_comments: 10,
      comments_truncated: false,
      article_status: "fetched",
      sentiment: { included_comments: 10 },
    },
  },
};

const relatedStories: RelatedStory[] = [
  {
    hn_id: "90000004",
    title: "A related mocked story",
    url: "https://example.org/related",
    takeaway: "A related takeaway.",
    date_added: new Date("2026-09-26T09:00:00Z"),
  },
];

function render(element: ReactElement) {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: {} as never }, element),
  );
}

test("mocked story renders the reading journey and recommendations without a database", () => {
  const html = render(createElement(StoryContent, { story, relatedStories }));
  assert.match(html, /<h1>A mocked story title<\/h1>/);
  assert.match(html, /id="article-heading"[^>]*>TLDR;/);
  assert.match(html, /The mocked article brief/);
  assert.match(html, /id="discussion-heading"[^>]*>.*?<span>Discussion<\/span><\/h2>/);
  assert.match(html, /The mocked discussion brief/);
  assert.match(html, /Low skepticism/);
  assert.match(html, /href="\/story\/90000004"/);
  assert.match(html, /href="\/category\/agents-coding"/);
  assert.doesNotMatch(html, /story-metrics/);
});

test("mocked story states distinguish missing comments and pending summaries", () => {
  const noComments: Story = {
    ...story,
    summary: {
      ...story.summary!,
      sentiment: null,
      source_coverage: { ...story.summary!.source_coverage, sentiment: { included_comments: 0 } },
    },
  };
  const noCommentsHTML = render(
    createElement(StoryContent, { story: noComments, relatedStories: [] }),
  );
  assert.match(noCommentsHTML, /No comment evidence/);
  assert.match(noCommentsHTML, /More in Agents &amp; Coding/);

  const pendingHTML = render(
    createElement(StoryContent, { story: { ...story, summary: null }, relatedStories: [] }),
  );
  assert.doesNotMatch(pendingHTML, /skepticism-pill/);
  assert.match(pendingHTML, /Summary pending/);
  assert.doesNotMatch(pendingHTML, /The mocked article brief/);
});

test("mocked feed row preserves a story link, category and shared Share control", () => {
  const html = render(createElement(StoryRow, { story, variant: "ranked" }));
  assert.match(html, /href="\/story\/90000001"/);
  assert.match(html, /href="\/category\/agents-coding"/);
  assert.match(html, /aria-label="Share: A mocked story title"/);
});

test("cards and detail use a ready canonical image while invalid states keep the text fallback", () => {
  const withImage = {
    ...story,
    image_status: "ready",
    image_url: "https://store.public.blob.vercel-storage.com/articles/90000001.webp",
    image_width: 1200,
    image_height: 675,
    image_mime_type: "image/webp",
  };
  const card = render(createElement(StoryRow, { story: withImage, variant: "ranked" }));
  const detail = render(createElement(StoryContent, { story: withImage, relatedStories: [] }));
  assert.match(card, /class="feed-story-image"/);
  assert.match(detail, /class="story-article-image"/);
  assert.match(detail, /width="1200" height="675"/);
  assert.match(card, /alt=""/);
  assert.ok(
    card.indexOf('href="/category/agents-coding"') < card.indexOf('class="feed-story-image"'),
    "the category context precedes the image in the feed row DOM",
  );
  for (const image_status of [null, "pending", "failed"] as const) {
    const html = render(
      createElement(StoryRow, { story: { ...withImage, image_status }, variant: "ranked" }),
    );
    assert.doesNotMatch(html, /feed-story-image|blob\.vercel-storage/);
  }
  const invalid = render(
    createElement(StoryContent, {
      story: { ...withImage, image_url: "https://publisher.example/private-image.jpg" },
      relatedStories: [],
    }),
  );
  assert.doesNotMatch(invalid, /story-article-image|publisher\.example/);
});

test("compact header and recommendations preserve the new story component and tracking", () => {
  const html = render(createElement(StoryContent, { story, relatedStories }));
  const header = html.match(/<header class="story-header">([\s\S]*?)<\/header>/)?.[1] ?? "";
  assert.ok(header.indexOf("story-breadcrumbs") < header.indexOf("<h1>"));
  assert.doesNotMatch(header, /skepticism-pill|points/);
  assert.match(header, /aria-label="Breadcrumb"/);
  assert.match(header, /href="\/">[^<]*Top Stories/);
  assert.match(header, /href="\/category\/agents-coding"/);
  assert.match(header, /class="story-metadata"/);
  assert.match(header, /Added <time dateTime="2026-09-26T10:00:00.000Z"/);
  assert.match(header, /Original article on example.com/);
  assert.match(header, /aria-label="Share: A mocked story title"/);
  assert.match(
    html,
    /id="discussion-heading"[^>]*>.*?<span>Discussion<\/span><\/h2><span class="skepticism-pill/,
  );
  const next = html.match(/<ul class="related-story-list">([\s\S]*?)<\/ul>/)?.[1] ?? "";
  assert.match(next, /related-topic/);
  assert.match(next, /example.org/);
  assert.doesNotMatch(next, /feed-excerpt|Added |<time /);
});

test("legacy takeaway caveats remain visible after the compact deck", () => {
  const takeaway =
    "Repeated attempts increase costs; " + "Review and maintenance also matter. ".repeat(10);
  const legacy = { ...story, summary: { ...story.summary!, overall_takeaway: takeaway } };
  const html = render(createElement(StoryContent, { story: legacy, relatedStories: [] }));
  const deck = html.match(/<p class="standfirst">([^<]*)<\/p>/)?.[1] ?? "";
  assert.ok(deck.length > 0 && deck.length <= 220);
  const tldr = html.match(/<section class="tldr-section"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.ok(tldr.includes(takeaway.trim()));
});

for (const [active, expected] of [
  ["home", ["/"]],
  [undefined, []],
  ["agents_coding", ["/category/agents-coding"]],
] as const) {
  test(`topic sidebar current destination is explicit: ${active ?? "archive"}`, () => {
    const html = render(createElement(BrowseLayout, { active, children: "Feed" }));
    const current = [...html.matchAll(/<a\b([^>]*)>/g)]
      .filter(([, attributes]) => attributes.includes('aria-current="page"'))
      .map(([, attributes]) => attributes.match(/href="([^"]+)"/)?.[1]);
    assert.deepEqual(current, expected);
  });
}

test("ranked card footer separates points, comments and movement between updates", () => {
  const history = (ranks: number[]) =>
    ranks.map((rank, i) => ({ rank, observed_at: `2026-09-26T${10 + i}:00:00Z` }));
  for (const [ranks, label, value] of [
    [[9, 7, 3], "Climbed 4 positions", "+4"],
    [[2, 3, 6], "Dropped 3 positions", "−3"],
    [[2, 3, 3], "Hacksnap rank unchanged", "0"],
    [[3], "Hacksnap rank movement unavailable", "—"],
  ] as const) {
    const ranked = { ...story, rank: String(ranks.at(-1)), rank_history: history([...ranks]) };
    const html = render(createElement(StoryRow, { story: ranked, variant: "ranked" }));
    assert.ok(html.includes(label));
    assert.ok(html.includes(`<span aria-hidden="true">${value}</span>`));
    assert.match(html, /lucide-star/);
    assert.match(html.replace(/<[^>]*>/g, ""), /12 comments/);
    assert.doesNotMatch(render(createElement(StoryRow, { story: ranked })), /rank-movement/);
  }
});

test("leading card reports a climb since the most recent saved rank", () => {
  const ranked = {
    ...story,
    rank: "1",
    rank_history: [
      { rank: 2, observed_at: "2026-09-26T10:00:00Z" },
      { rank: 2, observed_at: "2026-09-26T11:00:00Z" },
    ],
  };
  const html = render(createElement(StoryRow, { story: ranked, variant: "ranked" }));
  assert.match(html, /aria-label="Rank 1"/);
  assert.match(html, /Climbed 1 position in Hacksnap since the previous update/);
  assert.match(html, /<span aria-hidden="true">\+1<\/span>/);
  assert.match(html, /lucide-chevrons-up/);
});

const discussionFixtures: { id: string; expected: DiscussionAnalysis }[] = JSON.parse(
  readFileSync(new URL("../../fixtures/discussion-analysis/valid.json", import.meta.url), "utf8"),
);

test("new discussion replaces old points, retains its introduction and has a stable feed anchor", () => {
  const analysis = discussionFixtures[0].expected;
  const next: Story = {
    ...story,
    summary: {
      ...story.summary!,
      discussion_analysis: analysis,
      discussion_points: [
        { title: "Old duplicate theme", summary: "Repeated content", comment_ids: [101] },
      ],
      source_coverage: { ...story.summary!.source_coverage, included_comments: 0 },
      discussion_analysis_coverage: {
        stored_comments: 4,
        included_comments: 3,
        comments_truncated: true,
        selection_method: "active_branches_with_ancestors_v1",
      },
      discussion_analyzed_at: "2026-09-27T12:00:00Z",
    },
  };
  const html = render(createElement(StoryContent, { story: next, relatedStories: [] }));
  assert.match(html, /id="discussion-analysis"/);
  assert.match(html, /The mocked discussion brief/);
  assert.match(html, /3 comments analyzed/);
  assert.match(html, /Most critical/);
  assert.doesNotMatch(html, /Old duplicate theme|Repeated content|skepticism-pill/);
});

test("legacy null and missing analysis keep cited discussion points without pending labels", () => {
  for (const discussion_analysis of [null, undefined]) {
    const legacy: Story = {
      ...story,
      summary: {
        ...story.summary!,
        discussion_analysis,
        sentiment: null,
        discussion_points: [
          { title: "Legacy evidence", summary: "Preserved discussion", comment_ids: [123] },
        ],
      },
    };
    const html = render(createElement(StoryContent, { story: legacy, relatedStories: [] }));
    assert.match(html, /Preserved discussion/);
    assert.match(html, /Source comment 123 for Legacy evidence/);
    assert.match(html, /Skepticism unavailable/);
    assert.doesNotMatch(html.replace(/<[^>]*>/g, ""), /pending|Most supportive|Most critical/i);
  }
});

test("no-comments analysis suppresses stale discussion introduction", () => {
  const noComments: Story = {
    ...story,
    summary: {
      ...story.summary!,
      discussion_analysis: discussionFixtures.find((item) => item.id === "no_comments")!.expected,
    },
  };
  const html = render(createElement(StoryContent, { story: noComments, relatedStories: [] }));
  assert.match(html, /No usable comments were available for this analysis/);
  assert.doesNotMatch(html, /The mocked discussion brief/);
});

for (const variant of ["ranked", "unranked"] as const) {
  for (const selected_evidence of [
    { critical: 1, supportive: 0 },
    { critical: 0, supportive: 1 },
  ]) {
    test(`${variant} cards omit discussion previews while preserving the brief and actions`, () => {
      const card = {
        ...story,
        rank: "1",
        summary: {
          ...story.summary!,
          discussion_analysis_preview: {
            status: "available" as const,
            topics: [
              { key: "cost" as const, title: "Costs & tradeoffs", summary: "Hidden topic summary" },
              {
                key: "evidence" as const,
                title: "Evidence " + "long-title".repeat(30),
                summary: "Hidden evidence",
              },
              { key: "other" as const, title: "Third theme", summary: "Hidden third" },
            ],
            selected_evidence,
          },
        },
      };
      const html = render(createElement(StoryRow, { story: card, variant }));
      assert.doesNotMatch(
        html,
        /Discussion themes|Costs &amp; tradeoffs|long-title|Read the debate|#discussion-analysis/,
      );
      assert.match(html, /href="\/story\/90000001"/);
      assert.match(html, /href="\/category\/agents-coding"/);
      assert.match(html, /A test takeaway/);
      assert.match(html, /aria-label="Share: A mocked story title"/);
      assert.doesNotMatch(html, /Third theme|Hidden topic summary|Hidden evidence|consensus|%/);
    });
  }
}

test("topics without stance evidence also stay off the cards", () => {
  for (const status of ["available", "insufficient_context"] as const) {
    const html = render(
      createElement(StoryRow, {
        story: {
          ...story,
          summary: {
            ...story.summary!,
            discussion_analysis_preview: {
              status,
              topics: [{ key: "cost", title: "Operating costs", summary: "Hidden summary" }],
              selected_evidence: { critical: 0, supportive: 0 },
            },
          },
        },
      }),
    );
    assert.doesNotMatch(
      html,
      /Discussion themes|Operating costs|Read the debate|Hidden summary|pending/i,
    );
  }
});

test("missing, null, empty and no-comments previews add no discussion UI", () => {
  for (const preview of [
    undefined,
    null,
    { status: "available" as const, topics: [], selected_evidence: { critical: 0, supportive: 0 } },
    {
      status: "no_comments" as const,
      topics: [],
      selected_evidence: { critical: 0, supportive: 0 },
    },
  ]) {
    const html = render(
      createElement(StoryRow, {
        story: {
          ...story,
          summary: { ...story.summary!, discussion_analysis_preview: preview },
        },
      }),
    );
    assert.doesNotMatch(html, /feed-discussion|Read the debate|pending/i);
    assert.match(html, /A test takeaway/);
  }
});

test("discussion paragraphs stay separate and escaped for current and legacy summaries", () => {
  for (const discussion_analysis of [undefined, discussionFixtures[0].expected]) {
    const next: Story = {
      ...story,
      summary: {
        ...story.summary!,
        discussion_analysis,
        discussion_summary:
          "  The central question is production reliability.\r\n\r\nA separate concern is latency.\n \n<script>unsafe</script>  ",
      },
    };
    const html = render(createElement(StoryContent, { story: next, relatedStories: [] }));
    assert.match(html, /<p>The central question is production reliability\.<\/p>/);
    assert.match(html, /<p>A separate concern is latency\.<\/p>/);
    assert.match(html, /<p>&lt;script&gt;unsafe&lt;\/script&gt;<\/p>/);
    assert.doesNotMatch(html, /<script>unsafe|<p>\s*<\/p>/);
  }
});

test("Discussion opening and bullets render as a safe list for current and legacy analysis", () => {
  for (const discussion_analysis of [undefined, discussionFixtures[0].expected]) {
    const next: Story = {
      ...story,
      summary: {
        ...story.summary!,
        discussion_analysis,
        discussion_summary:
          "The question is production reliability.\n\n- Evidence: One workload was measured.\n- Limits: <script>unsafe</script> & unverified.",
      },
    };
    const html = render(createElement(StoryContent, { story: next, relatedStories: [] }));
    assert.match(html, /<p>The question is production reliability\.<\/p>/);
    assert.match(
      html,
      /<ul class="key-points"><li>Evidence: One workload was measured\.<\/li><li>Limits: &lt;script&gt;unsafe&lt;\/script&gt; &amp; unverified\.<\/li><\/ul>/,
    );
    assert.doesNotMatch(html, /<script>unsafe|<p>- Evidence/);
  }
});

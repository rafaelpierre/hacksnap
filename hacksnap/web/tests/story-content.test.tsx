import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DiscussionAnalysis } from "../lib/discussion-analysis";
import { test } from "@jest/globals";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { createRequire } from "node:module";
const { JSDOM } = createRequire(import.meta.url)("jsdom");
import { StoryContent } from "../app/story/[id]/story-content";
import { StoryRow } from "../app/story-row";
import { BrowseLayout } from "../app/topic-sidebar";
import type { Story, RelatedStory } from "../lib/data";
import { readingContext } from "../lib/reading-metadata";

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

test("reading metadata identifies copy revisions without treating popularity as a new version", () => {
  const initial = readingContext(story);
  assert.equal(
    readingContext({ ...story, points: 999 }).content_revision,
    initial.content_revision,
  );
  assert.equal(
    readingContext({
      ...story,
      summary: { ...story.summary!, generated_at: "2026-10-16T00:00:00Z" },
    }).content_revision,
    initial.content_revision,
  );
  assert.notEqual(
    readingContext({
      ...story,
      summary: { ...story.summary!, article_summary: "Revised article." },
    }).content_revision,
    initial.content_revision,
  );
  assert.equal(readingContext({ ...story, summary: null }).summary_status, "pending");
  const dom = new JSDOM(render(createElement(StoryContent, { story, relatedStories })));
  const markers = [...dom.window.document.querySelectorAll("[data-reading-id]")];
  const ids = markers.map((element) => element.getAttribute("data-reading-id"));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("opening_1"));
  assert.ok(ids.includes("brief_1"));
  assert.ok(ids.includes("key_points_1"));
  assert.ok(ids.includes("related_1"));
  dom.window.close();
});

test("formatted article and legacy discussion render safely and export plain structured data", () => {
  const formatted: Story = {
    ...story,
    summary: {
      ...story.summary!,
      article_summary:
        "A **reported result**.\n\n## Test setup\n\nOne workload.\n\n### Caveat\n\nLimited scope.",
      article_key_points: ["A **fixed baseline**."],
      discussion_points: [
        { title: "Evidence", summary: "A **self-reported test**.", comment_ids: [123] },
      ],
    },
  };
  const html = render(createElement(StoryContent, { story: formatted }));
  assert.match(html, /<h2>Test setup<\/h2>/);
  assert.match(html, /<h3>Caveat<\/h3>/);
  assert.match(html, /<li>A <strong>fixed baseline<\/strong>\.<\/li>/);
  assert.match(html, /A <strong>self-reported test<\/strong>\./);
  const script = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)!;
  const graph = JSON.parse(script[1])["@graph"];
  assert.match(graph[0].articleBody, /Test setup/);
  assert.doesNotMatch(graph[0].articleBody, /\*\*|##/);
});

test("external links open new tabs across feed, legacy and pending story states", () => {
  const legacy: Story = {
    ...story,
    summary: {
      ...story.summary!,
      discussion_points: [{ title: "Evidence", summary: "A point.", comment_ids: [90000002] }],
    },
  };
  const elements = [
    createElement(StoryRow, { story }),
    ...[
      story,
      legacy,
      { ...story, summary: null },
      { ...story, url: "https://news.ycombinator.com/item?id=90000001", summary: null },
    ].map((item) => createElement(StoryContent, { story: item, relatedStories })),
  ];
  for (const element of elements) {
    const dom = new JSDOM(render(element));
    const document: Document = dom.window.document;
    const external = document.querySelectorAll('a[href^="https://"]');
    assert.ok(external.length > 0);
    for (const link of external) {
      assert.equal(link.getAttribute("target"), "_blank", link.getAttribute("href")!);
      assert.equal(link.getAttribute("rel"), "noopener noreferrer");
    }
    const internal = document.querySelectorAll('a[href^="/"]');
    assert.ok(internal.length > 0);
    for (const link of internal) assert.equal(link.getAttribute("target"), null);
    dom.window.close();
  }
});

function render(element: ReactElement) {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: {} as never }, element),
  );
}

test("server-rendered stories include schema and forum links target the displayed analysis topics", () => {
  const analyzed = {
    ...story,
    summary: {
      ...story.summary!,
      discussion_analyzed_at: "2026-10-09T10:00:00Z",
      discussion_analysis: {
        status: "available" as const,
        reference_claims: [],
        critical_comments: [],
        supportive_comments: [],
        topics: [
          {
            key: "evidence" as const,
            title: "Evidence",
            summary: "Evidence is **limited**.",
            comment_ids: [123],
          },
        ],
      },
    },
  };
  const html = render(createElement(StoryContent, { story: analyzed }));
  const script = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(script);
  const graph = JSON.parse(script[1])["@graph"];
  assert.equal(graph[0]["@type"], "Article");
  assert.equal(graph[1]["@type"], "BreadcrumbList");
  assert.equal(graph[2]["@type"], "DiscussionForumPosting");
  const fragment = new URL(graph[2].url).hash.slice(1);
  assert.ok(html.includes(`id="${fragment}"`));
  assert.equal(graph[2].headline, "Evidence");
  assert.equal(graph[2].text, "Evidence is limited.");
  const pending = render(createElement(StoryContent, { story: { ...story, summary: null } }));
  assert.doesNotMatch(pending, /application\/ld\+json/);
});

test("mocked story renders the reading journey and recommendations without a database", () => {
  const html = render(createElement(StoryContent, { story, relatedStories }));
  assert.match(html, /<h1>A mocked story title<\/h1>/);
  assert.doesNotMatch(html, /article-heading|<h2[^>]*>Article brief/);
  assert.match(html, /The mocked article brief/);
  assert.match(
    html,
    /id="discussion-themes-heading"[^>]*>.*?<span>Discussion analysis<\/span><\/h2>/,
  );
  assert.doesNotMatch(html, /The mocked discussion brief/);
  assert.match(html, /Low skepticism/);
  assert.match(html, /href="\/story\/90000004"/);
  assert.match(html, /href="\/\?category=agents-coding"/);
  assert.doesNotMatch(html, /story-metrics/);
});

test("article key points render the exact heading before a nonempty list", () => {
  const html = render(createElement(StoryContent, { story, relatedStories: [] }));
  assert.match(
    html,
    /<h2[^>]*>The bits that matter<\/h2><ul class="key-points"[^>]*><li>A concrete point\.<\/li><\/ul>/,
  );
});

test("available article with no key points keeps its brief without the heading or list", () => {
  const html = render(
    createElement(StoryContent, {
      story: { ...story, summary: { ...story.summary!, article_key_points: [] } },
      relatedStories: [],
    }),
  );
  assert.match(html, /<p>The mocked article brief\.<\/p>/);
  assert.doesNotMatch(html, /The bits that matter|class="key-points-heading"|class="key-points"/);
});

test("article brief preserves its paragraph without injecting links or sentence breaks", () => {
  const article_summary =
    'Dr. Smith says version 3.5 costs $2.50 per run. Does it help? Yes! <script>alert("unsafe")</script>';
  const html = render(
    createElement(StoryContent, {
      story: { ...story, summary: { ...story.summary!, article_summary } },
    }),
  );
  assert.match(
    html,
    /<p>Dr\. Smith says version 3\.5 costs \$2\.50 per run\. Does it help\? Yes! &lt;script&gt;/,
  );
  assert.doesNotMatch(html, /article-brief-sentence/);
  assert.doesNotMatch(html, /<script>alert/);
});
test.each([story.url, "javascript:alert(1)", "https://news.ycombinator.com/item?id=1", "invalid"])(
  "article opening stays unlinked regardless of the source: %s",
  (url) => {
    const html = render(createElement(StoryContent, { story: { ...story, url } }));
    const dom = new JSDOM(html);
    const brief = dom.window.document.querySelector(".article-summary");
    assert.equal(brief.textContent, story.summary!.article_summary);
    assert.equal(brief.querySelectorAll("a, span, br").length, 0);
    dom.window.close();
  },
);

test("punctuation-led summaries never create empty links", () => {
  const html = render(
    createElement(StoryContent, {
      story: {
        ...story,
        summary: { ...story.summary!, article_summary: '"Quoted opening": details.' },
      },
    }),
  );
  assert.doesNotMatch(html, /article-brief-sentence/);
  assert.match(html, /&quot;Quoted opening&quot;: details\./);
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

test("feed rail keeps accessible counts, the HN link and sharing", () => {
  const html = render(createElement(StoryRow, { story, variant: "ranked" }));
  assert.match(html, /href="\/story\/90000001"/);
  assert.match(html, /href="\/\?category=agents-coding"/);
  assert.match(html, /class="feed-story-rail"/);
  assert.match(html, /class="sr-only"> points/);
  assert.match(html, /class="sr-only"> comments/);
  assert.match(html, /href="https:\/\/news.ycombinator.com\/item\?id=90000001"/);
  assert.doesNotMatch(html, /Read brief|Discussion analysis|feed-story-actions/);
  assert.match(html, /aria-label="Share: A mocked story title"/);
  assert.match(html, /lucide-forward/);
});

test("ranked and unranked cards share semantic order, with Archive limited to ranked stories", () => {
  const older = {
    ...story,
    is_recent: false,
    summary: null,
    image_status: "ready",
    image_url: "https://caiasssg5nuaa1i1.public.blob.vercel-storage.com/articles/90000001.webp",
    image_width: 1200,
    image_height: 675,
    image_mime_type: "image/webp",
  };
  const ranked = render(createElement(StoryRow, { story: older, variant: "ranked" }));
  const unranked = render(createElement(StoryRow, { story: older, variant: "unranked" }));

  for (const html of [ranked, unranked]) {
    assert.match(html, /<article class="story-row feed-story">/);
    const context = html.indexOf("story-context");
    const title = html.indexOf('<h2 class="feed-story-title">');
    const image = html.indexOf("feed-story-image");
    const excerpt = html.indexOf("Brief pending.");
    assert.ok(context >= 0 && context < title);
    assert.ok(title >= 0 && title < excerpt);
    assert.ok(excerpt >= 0 && excerpt < image);
    assert.match(html, /Brief pending\. Check back after the next summary update\./);
    assert.match(html, /class="feed-story-rail"/);
    assert.match(html, /12 comments/);
  }
  assert.match(ranked, /class="archive-label">Archive/);
  assert.doesNotMatch(unranked, /archive-label|Archive/);
});

test("cards and detail use a ready canonical image while invalid states keep the text fallback", () => {
  const withImage = {
    ...story,
    image_status: "ready",
    image_url: "https://caiasssg5nuaa1i1.public.blob.vercel-storage.com/articles/90000001.webp",
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
    card.indexOf('href="/?category=agents-coding"') < card.indexOf('class="feed-story-image"'),
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
  const header = html.match(/<header class="story-header"[^>]*>([\s\S]*?)<\/header>/)?.[1] ?? "";
  assert.ok(header.indexOf("story-context") < header.indexOf("<h1>"));
  assert.doesNotMatch(header, /skepticism-pill/);
  assert.match(header, /42 points/);
  assert.doesNotMatch(header, /story-breadcrumbs|aria-label="Breadcrumb"/);
  assert.match(header, /href="\/\?category=agents-coding"/);
  assert.match(header, /class="story-context"/);
  assert.match(header, /class="category-badge/);
  assert.match(header, /<time class="story-age" dateTime="2026-09-26T10:00:00.000Z"/);
  assert.doesNotMatch(header, /class="back-link"/);
  assert.doesNotMatch(html, /story-source-actions|Read original article|Open Hacker News thread/);
  assert.match(header, /aria-label="Share: A mocked story title"/);
  assert.match(html, /class="skepticism"/);
  const next = html.match(/<ul class="related-story-list">([\s\S]*?)<\/ul>/)?.[1] ?? "";
  assert.match(next, /related-topic/);
  assert.doesNotMatch(next, /example.org|related-story-meta|<svg/);
  assert.match(next, /A related takeaway/);
  assert.doesNotMatch(next, /Added |<time /);
});

test("legacy takeaway caveats remain visible after the compact deck", () => {
  const takeaway =
    "Repeated attempts increase costs; " + "Review and maintenance also matter. ".repeat(10);
  const legacy = { ...story, summary: { ...story.summary!, overall_takeaway: takeaway } };
  const html = render(createElement(StoryContent, { story: legacy, relatedStories: [] }));
  const deck = html.match(/<p class="standfirst">([^<]*)<\/p>/)?.[1] ?? "";
  assert.ok(deck.length > 0 && deck.length <= 220);
  const tldr =
    html.match(
      /<section id="article-brief" class="tldr-section detail-section"[\s\S]*?<\/section>/,
    )?.[0] ?? "";
  assert.ok(tldr.includes(takeaway.trim()));
});

test("browse content retains a focus target inside the shared site shell", () => {
  const html = render(createElement(BrowseLayout, { children: "Feed content" }));
  assert.doesNotMatch(html, /<nav/);
  assert.match(html, /id="browse-content" tabindex="-1"/);
  assert.match(html, /Feed content/);
});

test("reader rail replaces section navigation while keeping section anchors", () => {
  const html = render(createElement(StoryContent, { story, relatedStories }));
  assert.doesNotMatch(html, /aria-label="Story sections"|story-stats|detail-nav/);
  assert.match(html, /class="feed-story-rail"/);
  assert.match(html, /title="42 points"/);
  assert.match(html, /title="12 comments"/);
  assert.match(html, /lucide-forward/);
  for (const id of ["article-brief", "discussion-analysis"]) {
    assert.ok(!html.includes(`href="#${id}"`));
    assert.match(html, new RegExp(`<section[^>]*id="${id}"[^>]*tabindex="-1"`));
  }
  assert.match(html, /id="related-stories-heading">Continue reading/);
});

test("ranked card footer shows points and comments without rank movement", () => {
  const ranked = {
    ...story,
    rank: "3",
    rank_history: [
      { rank: 9, observed_at: "2026-09-26T10:00:00Z" },
      { rank: 3, observed_at: "2026-09-26T11:00:00Z" },
    ],
  };
  const html = render(createElement(StoryRow, { story: ranked, variant: "ranked" }));
  assert.match(html, /lucide-arrow-up/);
  assert.match(html.replace(/<[^>]*>/g, ""), /12 comments/);
  assert.doesNotMatch(html, /rank-movement|Climbed|Dropped|lucide-chevrons/);
});

test("leading card uses the same styling without a rank badge", () => {
  const ranked = {
    ...story,
    rank: "1",
    rank_history: [
      { rank: 2, observed_at: "2026-09-26T10:00:00Z" },
      { rank: 2, observed_at: "2026-09-26T11:00:00Z" },
    ],
  };
  const html = render(createElement(StoryRow, { story: ranked, variant: "ranked" }));
  assert.match(html, /<article class="story-row feed-story">/);
  assert.doesNotMatch(html, /class="rank"|aria-label="Rank 1"|feed-story-lead/);
  assert.doesNotMatch(html, /rank-movement|Climbed|lucide-chevrons-up/);
});

const discussionFixtures: { id: string; expected: DiscussionAnalysis }[] = JSON.parse(
  readFileSync(new URL("../../fixtures/discussion-analysis/valid.json", import.meta.url), "utf8"),
);

test("new discussion replaces old points and shows only themes at the stable anchor", () => {
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
  assert.match(html, /Discussion analysis/);
  assert.match(html, /3 comments analyzed/);
  assert.doesNotMatch(html, /The mocked discussion brief|Most critical|Most supportive/);
  assert.doesNotMatch(html, /Old duplicate theme|Repeated content|skepticism-pill/);
});

test("legacy null and missing analysis keep visible discussion points without source controls", () => {
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
    assert.doesNotMatch(html, /Source comment 123 for Legacy evidence|analysis-theme-details/);
    assert.match(html, /<h3[^>]*><span>Legacy evidence/);
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
      assert.doesNotMatch(html, /Costs &amp; tradeoffs|long-title|Read the debate/);
      assert.match(html, /href="\/story\/90000001"/);
      assert.match(html, /href="\/\?category=agents-coding"/);
      assert.match(html, /A test takeaway/);
      assert.match(html, /class="feed-story-rail"/);
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
    assert.doesNotMatch(html, /Operating costs|Read the debate|Hidden summary|pending/i);
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
    assert.doesNotMatch(html, /feed-discussion-preview|Read the debate|pending/i);
    assert.match(html, /A test takeaway/);
  }
});

test("old discussion introductions are hidden for current and legacy summaries", () => {
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
    assert.doesNotMatch(
      html,
      /The central question is production reliability|A separate concern is latency|unsafe/,
    );
    assert.match(html, /Discussion analysis/);
  }
});

test("old discussion bullets are hidden for current and legacy analysis", () => {
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
    assert.doesNotMatch(
      html,
      /The question is production reliability|One workload was measured|unsafe/,
    );
    assert.match(html, /Discussion analysis/);
  }
});

test("unavailable article retains discussion without an article brief or source action row", () => {
  const unavailable: Story = {
    ...story,
    summary: {
      ...story.summary!,
      article_summary: null,
      article_key_points: [],
      source_coverage: { ...story.summary!.source_coverage, article_status: "unavailable" },
    },
  };
  const html = render(createElement(StoryContent, { story: unavailable, relatedStories: [] }));
  assert.match(html, /The original article was unavailable to summarize/);
  assert.doesNotMatch(
    html,
    /story-source-actions|Open the original source|Open Hacker News thread/,
  );
  assert.match(html, /Discussion analysis/);
  assert.doesNotMatch(html, /The mocked article brief|class="key-points"/);
});

test("HN posts omit the generic summary placeholder", () => {
  const post = {
    ...story,
    url: "https://news.ycombinator.com/item?id=123",
    summary: {
      ...story.summary!,
      article_summary: null,
      article_key_points: [],
    },
  };
  const output = render(createElement(StoryContent, { story: post }));
  assert.doesNotMatch(output, /This is an HN post|The discussion is summarized below/);
  assert.match(output, /Discussion analysis/);
});

for (const takeaway of ["", "A short takeaway.", "x".repeat(220)]) {
  test(`HN post with ${takeaway.length}-character takeaway omits empty brief region`, () => {
    const post = {
      ...story,
      url: "https://news.ycombinator.com/item?id=123",
      summary: {
        ...story.summary!,
        overall_takeaway: takeaway,
        article_summary: null,
        article_key_points: [],
      },
    };
    const dom = new JSDOM(render(createElement(StoryContent, { story: post })));
    assert.equal(dom.window.document.querySelector("#article-brief"), null);
    assert.equal(dom.window.document.querySelector('[data-reading-id="brief_1"]'), null);
    assert.ok(dom.window.document.querySelector("#discussion-analysis"));
    if (takeaway)
      assert.equal(dom.window.document.querySelector(".standfirst").textContent, takeaway);
    dom.window.close();
  });
}

test("HN posts retain brief regions with a longer takeaway or article summary", () => {
  for (const summary of [
    {
      ...story.summary!,
      overall_takeaway: "A longer takeaway. ".repeat(20),
      article_summary: null,
    },
    story.summary!,
  ]) {
    const post = { ...story, url: "https://news.ycombinator.com/item?id=123", summary };
    const dom = new JSDOM(render(createElement(StoryContent, { story: post })));
    const brief = dom.window.document.querySelector("#article-brief");
    assert.ok(brief);
    assert.ok(
      brief.textContent.includes(summary.article_summary ?? summary.overall_takeaway.trim()),
    );
    dom.window.close();
  }
});

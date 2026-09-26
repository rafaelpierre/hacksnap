import assert from "node:assert/strict";
import {test} from "node:test";
import {createElement, type ReactElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {AppRouterContext} from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import {StoryContent} from "../app/story/[id]/story-content";
import {StoryRow} from "../app/story-row";
import {BrowseLayout} from "../app/topic-sidebar";
import type {Story, RelatedStory} from "../lib/data";

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
      stored_comments: 12, included_comments: 10, comments_truncated: false,
      article_status: "fetched", sentiment: {included_comments: 10},
    },
  },
};

const relatedStories: RelatedStory[] = [{
  hn_id: "90000004", title: "A related mocked story", url: "https://example.org/related",
  takeaway: "A related takeaway.", date_added: new Date("2026-09-26T09:00:00Z"),
}];

function render(element: ReactElement) {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider, {value: {} as never}, element));
}

test("mocked story renders the reading journey and recommendations without a database", () => {
  const html = render(createElement(StoryContent, {story, relatedStories}));
  assert.match(html, /<h1>A mocked story title<\/h1>/);
  assert.match(html, /id="article-heading"[^>]*>TLDR;/);
  assert.match(html, /The mocked article brief/);
  assert.match(html, /id="discussion-heading"[^>]*>Discussion/);
  assert.match(html, /The mocked discussion brief/);
  assert.match(html, /Low skepticism/);
  assert.match(html, /href="\/story\/90000004"/);
  assert.match(html, /href="\/category\/agents-coding"/);
  assert.doesNotMatch(html, /story-metrics/);
});

test("mocked story states distinguish missing comments and pending summaries", () => {
  const noComments: Story = {...story, summary: {...story.summary!, sentiment: null,
    source_coverage: {...story.summary!.source_coverage, sentiment: {included_comments: 0}}}};
  const noCommentsHTML = render(createElement(StoryContent, {story: noComments, relatedStories: []}));
  assert.match(noCommentsHTML, /No comment evidence/);
  assert.match(noCommentsHTML, /More in Agents &amp; Coding/);

  const pendingHTML = render(createElement(StoryContent, {story: {...story, summary: null}, relatedStories: []}));
  assert.doesNotMatch(pendingHTML, /skepticism-pill/);
  assert.match(pendingHTML, /Summary pending/);
  assert.doesNotMatch(pendingHTML, /The mocked article brief/);
});

test("mocked feed row preserves a story link, category and shared Share control", () => {
  const html = render(createElement(StoryRow, {story, variant: "ranked"}));
  assert.match(html, /href="\/story\/90000001"/);
  assert.match(html, /href="\/category\/agents-coding"/);
  assert.match(html, /aria-label="Share: A mocked story title"/);
});


test("compact header and recommendations preserve the new story component and tracking", () => {
  const html = render(createElement(StoryContent, {story, relatedStories}));
  const header = html.match(/<header class="story-header">([\s\S]*?)<\/header>/)?.[1] ?? "";
  assert.ok(header.indexOf("category-badge") < header.indexOf("<h1>"));
  assert.doesNotMatch(header, /skepticism-pill|Added |points/);
  assert.match(html, /id="discussion-heading">Discussion<\/h2><span class="skepticism-pill/);
  const next = html.match(/<ul class="related-story-list">([\s\S]*?)<\/ul>/)?.[1] ?? "";
  assert.match(next, /related-topic/);
  assert.match(next, /example.org/);
  assert.doesNotMatch(next, /feed-excerpt|Added |<time /);
});

test("legacy takeaway caveats remain visible after the compact deck", () => {
  const takeaway = "Repeated attempts increase costs; " + "Review and maintenance also matter. ".repeat(10);
  const legacy = {...story, summary: {...story.summary!, overall_takeaway: takeaway}};
  const html = render(createElement(StoryContent, {story: legacy, relatedStories: []}));
  const deck = html.match(/<p class="standfirst">([^<]*)<\/p>/)?.[1] ?? "";
  assert.ok(deck.length > 0 && deck.length <= 220);
  const tldr = html.match(/<section class="tldr-section"[\s\S]*?<\/section>/)?.[0] ?? "";
  assert.ok(tldr.includes(takeaway.trim()));
});


for (const [active, expected] of [["home", ["/"]], [undefined, []], ["agents_coding", ["/category/agents-coding"]]] as const) {
  test(`topic sidebar current destination is explicit: ${active ?? "archive"}`, () => {
    const html = render(createElement(BrowseLayout, {active, children: "Feed"}));
    const current = [...html.matchAll(/<a\b([^>]*)>/g)]
      .filter(([, attributes]) => attributes.includes('aria-current="page"'))
      .map(([, attributes]) => attributes.match(/href="([^"]+)"/)?.[1]);
    assert.deepEqual(current, expected);
  });
}

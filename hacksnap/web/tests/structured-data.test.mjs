import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { StructuredData } from "../app/structured-data.tsx";
import { siteStructuredData, storyStructuredData } from "../lib/structured-data.ts";

const story = {
  hn_id: "123",
  story_slug: "saved-headline-123",
  title: "A headline & its context",
  category: "agents_coding",
  date_added: new Date("2026-09-29T10:00:00Z"),
  summary: {
    overall_takeaway: " A useful\n takeaway. ",
    article_summary: "The article brief.",
    article_key_points: ["One detail."],
    discussion_summary: "An old introduction which the page no longer displays.",
    discussion_points: [{ title: "Costs", summary: "Costs remain unclear.", comment_ids: [456] }],
    source_coverage: { included_comments: 10 },
    generated_at: "2026-09-29T12:00:00+01:00",
  },
};
const canonical = "https://hacksnap.live/story/saved-headline-123";

function markup(data) {
  const html = renderToStaticMarkup(createElement(StructuredData, { data }));
  const document = new JSDOM(html).window.document;
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  assert.equal(scripts.length, 1);
  return { document, data: JSON.parse(scripts[0].textContent) };
}

test("site JSON-LD preserves the site name and adds an identifiable publisher with a usable logo", () => {
  const { data } = markup(siteStructuredData);
  const [site, publisher] = data["@graph"];
  assert.equal(data["@context"], "https://schema.org");
  assert.equal(site["@type"], "WebSite");
  assert.equal(site.name, "Hacksnap");
  assert.equal(site.url, "https://hacksnap.live/");
  assert.equal(site.publisher["@id"], publisher["@id"]);
  assert.equal(publisher["@type"], "Organization");
  assert.equal(publisher.logo.url, "https://hacksnap.live/apple-icon.png");
  assert.ok(publisher.logo.width >= 112 && publisher.logo.height >= 112);
});

test("published briefs describe the canonical Hacksnap article and a complete breadcrumb path", () => {
  const { data } = markup(storyStructuredData(story));
  const [article, breadcrumbs] = data["@graph"];
  assert.equal(article["@type"], "Article");
  assert.equal(article.url, canonical);
  assert.equal(article.mainEntityOfPage["@id"], canonical);
  assert.equal(article.headline, story.title);
  assert.equal(article.description, "A useful takeaway.");
  assert.equal(article.author.name, "Hacksnap");
  assert.equal(article.author.url, "https://hacksnap.live/about");
  assert.equal(article.dateModified, "2026-09-29T11:00:00.000Z");
  assert.equal(article.datePublished, undefined);
  assert.equal(article.image, undefined);
  assert.equal(breadcrumbs["@type"], "BreadcrumbList");
  assert.deepEqual(breadcrumbs.itemListElement, [
    { "@type": "ListItem", position: 1, name: "Latest", item: "https://hacksnap.live/" },
    {
      "@type": "ListItem",
      position: 2,
      name: "Agents & Coding",
      item: "https://hacksnap.live/?category=agents-coding",
    },
    { "@type": "ListItem", position: 3, name: story.title, item: canonical },
  ]);
});

test("numeric URLs and uncategorized stories keep valid two-item breadcrumbs", () => {
  const [article, breadcrumbs] = storyStructuredData({
    ...story,
    story_slug: null,
    category: null,
  })["@graph"];
  assert.equal(article.url, "https://hacksnap.live/story/123");
  assert.equal(article.articleSection, undefined);
  assert.equal(breadcrumbs.itemListElement.length, 2);
  assert.equal(breadcrumbs.itemListElement[1].position, 2);
  assert.equal(breadcrumbs.itemListElement[1].item, article.url);
});

test("pending and blank summaries emit no article or breadcrumb script", () => {
  for (const summary of [
    null,
    ...[null, undefined, "", " \n\t"].map((overall_takeaway) => ({
      ...story.summary,
      overall_takeaway,
    })),
  ]) {
    const data = storyStructuredData({ ...story, summary });
    assert.equal(data, null);
    assert.equal(renderToStaticMarkup(createElement(StructuredData, { data })), "");
  }
});

test("only the actual ready page image is eligible for article markup", () => {
  const image = {
    image_url: "https://store-id.public.blob.vercel-storage.com/articles/123.webp",
    image_status: "ready",
    image_width: 1200,
    image_height: 675,
    image_mime_type: "image/webp",
  };
  assert.deepEqual(storyStructuredData({ ...story, ...image })["@graph"][0].image, [
    image.image_url,
  ]);
  for (const change of [
    { image_status: "pending" },
    { image_url: "javascript:alert(1)" },
    { image_width: 0 },
  ]) {
    assert.equal(
      storyStructuredData({ ...story, ...image, ...change })["@graph"][0].image,
      undefined,
    );
  }
});

test("visible legacy discussion summaries enter the article body with source citations", () => {
  const [article] = storyStructuredData(story)["@graph"];
  assert.match(article.articleBody, /The article brief\./);
  assert.match(article.articleBody, /One detail\./);
  assert.match(article.articleBody, /Costs\nCosts remain unclear\./);
  assert.doesNotMatch(article.articleBody, /old introduction/);
  assert.equal(article.hasPart["@type"], "WebPageElement");
  assert.equal(article.hasPart["@id"], `${canonical}#discussion-analysis`);
  assert.deepEqual(article.hasPart.citation, ["https://news.ycombinator.com/item?id=456"]);
  assert.equal(article.comment, undefined);
  assert.equal(article.commentCount, undefined);
});

test("discussion-only articles use current analysis, excluding superseded or hidden prose", () => {
  const summary = {
    ...story.summary,
    article_summary: null,
    discussion_analyzed_at: "2026-09-30T14:00:00Z",
    discussion_analysis: {
      status: "available",
      topics: [{ title: "Evidence", summary: "The sample is small.", comment_ids: [789, 789] }],
    },
  };
  const [article] = storyStructuredData({ ...story, summary })["@graph"];
  assert.match(article.articleBody, /Evidence\nThe sample is small\./);
  assert.doesNotMatch(article.articleBody, /article brief|One detail|Costs|old introduction/);
  assert.deepEqual(article.hasPart.citation, ["https://news.ycombinator.com/item?id=789"]);
  assert.equal(article.dateModified, "2026-09-30T14:00:00.000Z");
  const [empty] = storyStructuredData({
    ...story,
    summary: {
      ...summary,
      discussion_analysis: { ...summary.discussion_analysis, status: "no_comments" },
    },
  })["@graph"];
  assert.equal(empty.hasPart, undefined);
  assert.doesNotMatch(empty.articleBody, /Evidence|sample is small/);
});

test("empty legacy discussions omit hidden themes and malformed timestamps never reach JSON-LD", () => {
  const [article] = storyStructuredData({
    ...story,
    summary: {
      ...story.summary,
      generated_at: "invalid",
      discussion_analyzed_at: "2026-10-01T00:00:00Z",
      source_coverage: { included_comments: 0 },
    },
  })["@graph"];
  assert.equal(article.hasPart, undefined);
  assert.equal(article.dateModified, undefined);
  assert.doesNotMatch(article.articleBody, /Costs/);
});

test("untrusted titles and summaries round-trip without escaping their script element", () => {
  const attack = '</script><script>alert("xss")</script><!-- & <img src=x onerror=alert(1)>';
  const { document, data } = markup(
    storyStructuredData({
      ...story,
      title: attack,
      summary: { ...story.summary, overall_takeaway: attack },
    }),
  );
  assert.equal(document.querySelectorAll("script").length, 1);
  assert.equal(document.querySelectorAll("img").length, 0);
  assert.equal(data["@graph"][0].headline, attack);
  assert.equal(data["@graph"][0].description, attack);
});

test("current analysis topics emit separate forum posts with canonical anchors and stored dates", () => {
  const topics = [
    { key: "evidence", title: "Evidence", summary: "The sample is small.", comment_ids: [789] },
    { key: "cost", title: "Costs", summary: "Training costs dominate.", comment_ids: [456] },
  ];
  const summary = {
    ...story.summary,
    discussion_analyzed_at: "2026-09-30T14:00:00Z",
    discussion_analysis: { status: "available", topics },
  };
  const { data } = markup(storyStructuredData({ ...story, summary }));
  const posts = data["@graph"].filter((item) => item["@type"] === "DiscussionForumPosting");
  assert.equal(posts.length, 2);
  posts.forEach((post, index) => {
    const topic = topics[index];
    assert.equal(post.url, `${canonical}#discussion-topic-${topic.key}-${index}`);
    assert.equal(post["@id"], post.url);
    assert.equal(post.headline, topic.title);
    assert.equal(post.text, topic.summary);
    assert.equal(post.author.name, "Hacksnap");
    assert.equal(post.datePublished, "2026-09-30T14:00:00.000Z");
    assert.deepEqual(
      post.citation,
      topic.comment_ids.map((id) => `https://news.ycombinator.com/item?id=${id}`),
    );
    assert.equal(post.digitalSourceType, undefined);
    assert.equal(post.commentCount, undefined);
  });
  assert.deepEqual(
    data["@graph"][0].hasPart.hasPart,
    posts.map((post) => ({ "@id": post["@id"] })),
  );
  for (const discussion_analyzed_at of [null, undefined, "invalid"]) {
    const graph = storyStructuredData({
      ...story,
      summary: { ...summary, discussion_analyzed_at },
    })["@graph"];
    assert.equal(
      graph.some((item) => item["@type"] === "DiscussionForumPosting"),
      false,
    );
    assert.match(graph[0].articleBody, /The sample is small/);
  }
  for (const discussion_analysis of [
    null,
    { status: "no_comments", topics },
    { status: "available", topics: [] },
  ]) {
    const graph = storyStructuredData({ ...story, summary: { ...summary, discussion_analysis } })[
      "@graph"
    ];
    assert.equal(
      graph.some((item) => item["@type"] === "DiscussionForumPosting"),
      false,
    );
  }
});

import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { storyPath } from "../lib/story-url";
import type { PopularPeriod } from "../lib/popular-stories";

const getPopularStories = jest.fn<
  (
    period?: PopularPeriod,
  ) => Promise<Array<{ hn_id: string; title: string; story_slug?: string; views: string }>>
>(async () => []);
jest.unstable_mockModule("../lib/data", () => ({ getPopularStories }));
jest.unstable_mockModule("../app/story-navigation", () => ({
  BrowseStoryLink: ({
    children,
    id,
    slug,
    focusFeedStory,
  }: {
    children: React.ReactNode;
    id: string;
    slug?: string;
    focusFeedStory?: boolean;
  }) => {
    assert.equal(focusFeedStory, false, "Most read stories must not focus a feed card");
    return <a href={storyPath(id, slug)}>{children}</a>;
  },
}));
const { PopularStories, PopularStoriesLoading } = await import("../app/popular-stories");

test("popular stories preserve five full titles, ranking order and stored canonical URLs", async () => {
  const longTitle =
    "An unusually long story title that remains complete and wraps instead of being cut off at an arbitrary character boundary";
  getPopularStories.mockResolvedValueOnce(
    Array.from({ length: 6 }, (_, index) => ({
      hn_id: String(index + 1),
      title: index === 0 ? longTitle : `Title ${index + 1}`,
      story_slug: index === 0 ? "long-story-1" : undefined,
      views: String(100 - index),
    })),
  );
  const html = renderToStaticMarkup(await PopularStories());
  assert.match(html, /aria-labelledby="popular-stories-heading"/);
  assert.match(html, /Most read/);
  assert.doesNotMatch(html, /All time|role="tab"/);
  assert.match(html, /href="\/story\/long-story-1"/);
  assert.ok(html.includes(longTitle));
  assert.equal((html.match(/<li>/g) ?? []).length, 5);
  assert.ok(html.indexOf("Title 2") < html.indexOf("Title 5"));
  assert.doesNotMatch(html, /Title 6/);
});

test("empty, failed and loading optional reads retain the same sidebar shell", async () => {
  getPopularStories.mockResolvedValueOnce([]);
  const empty = renderToStaticMarkup(await PopularStories());
  getPopularStories.mockRejectedValueOnce(Error("private database details"));
  const failure = renderToStaticMarkup(await PopularStories());
  const loading = renderToStaticMarkup(<PopularStoriesLoading />);
  for (const html of [empty, failure, loading]) assert.match(html, /class="popular-stories"/);
  assert.match(empty, /will appear as readers visit/);
  assert.match(failure, /temporarily unavailable/);
  assert.doesNotMatch(failure, /private database/);
  assert.match(loading, /role="status"/);
});

test("weekly and lifetime widgets have separate headings and independent failure states", async () => {
  getPopularStories
    .mockRejectedValueOnce(Error("weekly unavailable"))
    .mockResolvedValueOnce([
      { hn_id: "7", title: "Lifetime story", story_slug: "lifetime-story-7", views: "99" },
    ]);
  const weekly = renderToStaticMarkup(await PopularStories({ period: "last-7-days" }));
  const lifetime = renderToStaticMarkup(await PopularStories());
  const html = weekly + lifetime;
  assert.match(html, /temporarily unavailable/);
  assert.match(html, /href="\/story\/lifetime-story-7"/);
  assert.match(weekly, /<h2 id="trending-stories-heading">Trending<\/h2>/);
  assert.match(lifetime, /<h2 id="popular-stories-heading">Most read<\/h2>/);
  assert.doesNotMatch(html, /All time|role="tab"|hidden=""/);
  assert.equal(getPopularStories.mock.calls.at(-2)?.[0], "last-7-days");
  assert.equal(getPopularStories.mock.calls.at(-1)?.[0], "all-time");
  getPopularStories.mockResolvedValueOnce([]);
  const empty = renderToStaticMarkup(await PopularStories({ period: "last-7-days" }));
  assert.match(empty, /No story reads recorded in the last 7 days/);
});

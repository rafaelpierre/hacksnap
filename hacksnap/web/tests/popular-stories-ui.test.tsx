import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { storyPath } from "../lib/story-url";

const getPopularStories = jest.fn<
  () => Promise<Array<{ hn_id: string; title: string; story_slug?: string; views: string }>>
>(async () => []);
jest.unstable_mockModule("../lib/data", () => ({ getPopularStories }));
jest.unstable_mockModule("../app/story-navigation", () => ({
  BrowseStoryLink: ({
    children,
    id,
    slug,
  }: {
    children: React.ReactNode;
    id: string;
    slug?: string;
  }) => <a href={storyPath(id, slug)}>{children}</a>,
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
  assert.match(html, /All time/);
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

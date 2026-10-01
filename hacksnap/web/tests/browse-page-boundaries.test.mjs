import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import { Suspense } from "react";

const missing = new Error("not found");
const shouldStreamBrowse = jest.fn(async () => true);
const getReadyStoryPage = jest.fn(async () => ({
  stories: [],
  ingestion: null,
  pagination: { page: 1, hasMore: false, cursor: null },
}));
const getCategoryStories = jest.fn(async () => ({ stories: [], hasNext: false }));

jest.unstable_mockModule("server-only", () => ({}));
jest.unstable_mockModule("next/cache", () => ({ unstable_noStore: () => {} }));
jest.unstable_mockModule("../lib/browse-streaming.ts", () => ({ shouldStreamBrowse }));
jest.unstable_mockModule("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => "/",
  notFound: () => {
    throw missing;
  },
}));
jest.unstable_mockModule("../lib/data.ts", () => ({
  getReadyStoryPage,
  getCategoryStories,
  getCategoryCounts: async () => ({}),
}));
jest.unstable_mockModule("../app/story-feed.tsx", () => ({ StoryFeed: () => null }));

const { default: Home } = await import("../app/[[...path]]/page.tsx");
const { default: CategoryPage } = await import("../app/category/[slug]/page.tsx");
const { ReadyStoryPageError } = await import("../lib/ready-story-pagination-errors.ts");

function home(path, query = {}) {
  return Home({ params: Promise.resolve({ path }), searchParams: Promise.resolve(query) });
}

function category(slug, page) {
  return CategoryPage({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve({ page }),
  });
}

test("valid first browse pages expose Suspense before their story read", async () => {
  getReadyStoryPage.mockClear();
  getCategoryStories.mockClear();
  const top = await home(undefined);
  const topic = await category("agents-coding");
  assert.equal(top.type, Suspense);
  assert.equal(topic.type, Suspense);
  assert.equal(getReadyStoryPage.mock.calls.length, 0);
  assert.equal(getCategoryStories.mock.calls.length, 0);
});

test("full document requests load their stories before returning a page", async () => {
  getReadyStoryPage.mockClear();
  getCategoryStories.mockClear();
  shouldStreamBrowse.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
  const top = await home(undefined);
  const topic = await category("agents-coding");
  assert.notEqual(top.type, Suspense);
  assert.notEqual(topic.type, Suspense);
  assert.equal(getReadyStoryPage.mock.calls.length, 1);
  assert.equal(getCategoryStories.mock.calls.length, 1);
});

test("invalid paths and data-dependent query pages finish validation before streaming", async () => {
  getReadyStoryPage.mockClear();
  getCategoryStories.mockClear();
  await assert.rejects(home(["missing"]), (error) => error === missing);
  await assert.rejects(category("unknown"), (error) => error === missing);
  await assert.rejects(category("agents-coding", "00"), (error) => error === missing);
  assert.equal(getReadyStoryPage.mock.calls.length, 0);
  assert.equal(getCategoryStories.mock.calls.length, 0);

  getReadyStoryPage.mockRejectedValueOnce(new ReadyStoryPageError("invalid_cursor"));
  await assert.rejects(home(undefined, { cursor: "" }), (error) => error === missing);
  assert.equal(getReadyStoryPage.mock.calls.length, 1);

  await assert.rejects(category("agents-coding", "2"), (error) => error === missing);
  assert.equal(getCategoryStories.mock.calls.length, 1);
});

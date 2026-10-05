import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import { Children, isValidElement, Suspense } from "react";

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

const { default: Home, generateMetadata: homeMetadata } =
  await import("../app/[[...path]]/page.tsx");
const { default: CategoryPage, generateMetadata } = await import("../app/category/[slug]/page.tsx");
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

test("the homepage Latest CTA uses its own pending navigation feedback", async () => {
  const { NavigationPendingLink } = await import("../app/navigation-pending-link.tsx");
  shouldStreamBrowse.mockResolvedValueOnce(false);
  const page = await home(undefined);
  function findCTA(node) {
    if (!isValidElement(node)) return undefined;
    if (node.props.className === "browse-latest-link") return node;
    return Children.toArray(node.props.children).map(findCTA).find(Boolean);
  }
  const cta = findCTA(page);
  assert.ok(cta);
  assert.equal(cta.type, NavigationPendingLink);
  assert.equal(cta.props.href, "/archive");
  assert.equal(cta.props.pendingLabel, "Loading latest stories…");
});

test("category search metadata is distinct, paginated, and available without a story read", async () => {
  const { CATEGORIES } = await import("../lib/categories.ts");
  getCategoryStories.mockClear();
  const titles = new Set();
  const descriptions = new Set();
  for (const category of CATEGORIES) {
    const props = (page) => ({
      params: Promise.resolve({ slug: category.slug }),
      searchParams: Promise.resolve({ page }),
    });
    const first = await generateMetadata(props(undefined));
    const second = await generateMetadata(props("2"));
    titles.add(first.title);
    descriptions.add(first.description);
    assert.match(first.title, /AI/);
    assert.match(first.description, /Hacker News discussions/);
    assert.equal(first.alternates.canonical, `/category/${category.slug}`);
    assert.equal(second.title, `${first.title} — Page 2`);
    assert.equal(second.description, `Page 2: ${first.description}`);
    assert.equal(second.alternates.canonical, `/category/${category.slug}?page=2`);
    for (const metadata of [first, second]) {
      assert.equal(metadata.openGraph.title, `${metadata.title} | Hacksnap`);
      assert.equal(metadata.openGraph.description, metadata.description);
      assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
      assert.equal(metadata.twitter.title, metadata.openGraph.title);
      assert.equal(metadata.twitter.description, metadata.description);
    }
  }
  assert.equal(titles.size, 6);
  assert.equal(descriptions.size, 6);
  assert.equal(getCategoryStories.mock.calls.length, 0);
  for (const [slug, page] of [
    ["unknown", undefined],
    ["agents-coding", "101"],
  ]) {
    await assert.rejects(
      generateMetadata({
        params: Promise.resolve({ slug }),
        searchParams: Promise.resolve({ page }),
      }),
      (error) => error === missing,
    );
  }
});

test("homepage continuation metadata excludes temporary selections without reading stories", async () => {
  getReadyStoryPage.mockClear();
  const metadata = (query) =>
    homeMetadata({ params: Promise.resolve({}), searchParams: Promise.resolve(query) });
  for (const query of [{}, { utm_source: "google" }]) {
    const clean = await metadata(query);
    assert.deepEqual(clean.robots, { index: true, follow: true });
    assert.equal(clean.alternates.canonical, "/");
    assert.equal(clean.alternates.types["application/rss+xml"], "https://hacksnap.live/feed.xml");
  }
  for (const query of [
    { page: "4", cursor: "frozen_selection" },
    { page: "4" },
    { page: "1" },
    { cursor: "expired_selection" },
    { page: "" },
    { cursor: "" },
    { page: ["1", "4"] },
    { cursor: ["one", "two"] },
  ]) {
    const continuation = await metadata(query);
    assert.deepEqual(continuation.robots, { index: false, follow: true });
    assert.equal(continuation.alternates?.canonical, undefined);
  }
  assert.equal(getReadyStoryPage.mock.calls.length, 0);
});

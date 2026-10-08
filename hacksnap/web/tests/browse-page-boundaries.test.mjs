import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import { Suspense } from "react";

const missing = new Error("not found");
const redirects = jest.fn((url) => {
  throw new Error(`redirect:${url}`);
});
const shouldStreamBrowse = jest.fn(async () => true);
const getReadyStoryPage = jest.fn(async () => ({
  stories: [],
  ingestion: null,
  pagination: { page: 1, hasMore: false, cursor: null },
}));
const getArchiveStories = jest.fn(async () => ({ stories: [], hasNext: false }));
const getCategoryStories = jest.fn(async () => ({ stories: [], hasNext: false }));

jest.unstable_mockModule("server-only", () => ({}));
jest.unstable_mockModule("next/cache", () => ({ unstable_noStore: () => {} }));
jest.unstable_mockModule("../lib/browse-streaming.ts", () => ({ shouldStreamBrowse }));
jest.unstable_mockModule("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  permanentRedirect: redirects,
  notFound: () => {
    throw missing;
  },
}));
jest.unstable_mockModule("../lib/data.ts", () => ({
  getStory: async () => null,
  getReadyStoryPage,
  getArchiveStories,
  getPopularStories: async () => [],
  getArchiveMonths: async () => [{ month: "2026-09" }],
  getCategoryStories,
  getCategoryCounts: async () => ({}),
}));
jest.unstable_mockModule("../app/story-feed.tsx", () => ({ StoryFeed: () => null }));

const { default: Home, generateMetadata: homeMetadata } =
  await import("../app/[[...path]]/page.tsx");
const { default: LegacyArchive } = await import("../app/archive/[[...date]]/page.tsx");
const { default: CategoryPage } = await import("../app/category/[slug]/page.tsx");

function home(path, query = {}) {
  return Home({ params: Promise.resolve({ path }), searchParams: Promise.resolve(query) });
}

function category(slug, page) {
  return home(undefined, { category: slug, page });
}

test("Latest starts its required read before optional data while category pages retain their streaming boundary", async () => {
  getReadyStoryPage.mockClear();
  getCategoryStories.mockClear();
  getArchiveStories.mockClear();
  const latest = await home(undefined);
  const topic = await category("agents-coding");
  assert.equal(latest.props.children.at(-1).props.children.type, Suspense);
  assert.equal(getArchiveStories.mock.calls.length, 1);
  assert.equal(topic.props.children.at(-1).props.children.type, Suspense);
  assert.equal(getReadyStoryPage.mock.calls.length, 0);
  assert.equal(getCategoryStories.mock.calls.length, 1);
});

test("full document requests load their stories before returning a page", async () => {
  getReadyStoryPage.mockClear();
  getCategoryStories.mockClear();
  shouldStreamBrowse.mockResolvedValueOnce(false);
  const topic = await category("agents-coding");
  assert.notEqual(topic.type, Suspense);
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

  await assert.rejects(category("agents-coding", "2"), (error) => error === missing);
  assert.equal(getCategoryStories.mock.calls.length, 1);
});

test("legacy archive URLs redirect to canonical Latest and dated feeds", async () => {
  for (const [date, query, destination] of [
    [undefined, {}, "/"],
    [undefined, { page: "1" }, "/"],
    [undefined, { page: "2" }, "/?page=2"],
    [["2026", "09"], {}, "/2026/09"],
    [["2026", "09"], { page: "2" }, "/2026/09?page=2"],
    [undefined, { page: "100", cursor: "obsolete" }, "/?page=100"],
  ]) {
    await assert.rejects(
      LegacyArchive({ params: Promise.resolve({ date }), searchParams: Promise.resolve(query) }),
      { message: `redirect:${destination}` },
    );
  }
  for (const date of [["missing"], ["2026", "13"], ["2026", "09", "extra"]])
    await assert.rejects(
      LegacyArchive({ params: Promise.resolve({ date }), searchParams: Promise.resolve({}) }),
      (error) => error === missing,
    );
  for (const page of ["0", "00", "101", "1.5", "-1", "", ["1", "2"]]) {
    await assert.rejects(home(undefined, { page }), (error) => error === missing);
    await assert.rejects(
      LegacyArchive({ params: Promise.resolve({}), searchParams: Promise.resolve({ page }) }),
      (error) => error === missing,
    );
  }
});

test("Latest renders directly and obsolete root cursor requests redirect to the clean page", async () => {
  getArchiveStories.mockClear();
  const first = await home(undefined);
  assert.notEqual(first.type, undefined);
  assert.equal(getArchiveStories.mock.calls.length, 1);
  for (const [query, destination] of [
    [{ cursor: "obsolete" }, "/"],
    [{ page: "2", cursor: "obsolete" }, "/?page=2"],
    [{ cursor: ["one", "two"] }, "/"],
  ])
    await assert.rejects(home(undefined, query), { message: `redirect:${destination}` });
  assert.equal(getArchiveStories.mock.calls.length, 1);
});

test("category search metadata is distinct, paginated, and available without a story read", async () => {
  const { CATEGORIES } = await import("../lib/categories.ts");
  getCategoryStories.mockClear();
  const titles = new Set();
  const descriptions = new Set();
  for (const category of CATEGORIES) {
    const props = (page) => ({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({ page, category: category.slug }),
    });
    const first = await homeMetadata(props(undefined));
    const second = await homeMetadata(props("2"));
    titles.add(first.title);
    descriptions.add(first.description);
    assert.match(first.title, /AI/);
    assert.match(first.description, /Hacker News discussions/);
    assert.equal(first.alternates.canonical, `/?category=${category.slug}`);
    assert.equal(second.title, `${first.title} — Page 2`);
    assert.equal(second.description, `Page 2: ${first.description}`);
    assert.equal(second.alternates.canonical, `/?category=${category.slug}&page=2`);
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
      homeMetadata({
        params: Promise.resolve({}),
        searchParams: Promise.resolve({ page, category: slug }),
      }),
      (error) => error === missing,
    );
  }
});

test("Latest pagination is canonical and indexable while obsolete cursors stay noindex", async () => {
  const metadata = (query) =>
    homeMetadata({ params: Promise.resolve({}), searchParams: Promise.resolve(query) });
  for (const [query, canonical] of [
    [{}, "/"],
    [{ utm_source: "google" }, "/"],
    [{ page: "1" }, "/"],
    [{ page: "4" }, "/?page=4"],
  ]) {
    const clean = await metadata(query);
    assert.deepEqual(clean.robots, { index: true, follow: true });
    assert.equal(clean.alternates.canonical, canonical);
    assert.equal(clean.alternates.types["application/rss+xml"], "https://hacksnap.live/feed.xml");
  }
  for (const query of [
    { page: "4", cursor: "frozen_selection" },
    { cursor: "expired_selection" },
    { cursor: "" },
    { cursor: ["one", "two"] },
  ]) {
    const continuation = await metadata(query);
    assert.deepEqual(continuation.robots, { index: false, follow: true });
    assert.equal(continuation.alternates?.canonical, undefined);
  }
  for (const page of ["", "101", ["1", "4"]])
    await assert.rejects(metadata({ page }), (error) => error === missing);
});

test("legacy category URLs redirect without reading stories", async () => {
  getCategoryStories.mockClear();
  for (const [page, target] of [
    [undefined, "/?category=agents-coding"],
    ["3", "/?category=agents-coding&page=3"],
  ]) {
    await assert.rejects(
      CategoryPage({
        params: Promise.resolve({ slug: "agents-coding" }),
        searchParams: Promise.resolve({ page }),
      }),
      { message: `redirect:${target}` },
    );
  }
  assert.equal(getCategoryStories.mock.calls.length, 0);
  await assert.rejects(
    home(undefined, { category: ["agents-coding", "models-products"] }),
    (error) => error === missing,
  );
  await assert.rejects(
    home(["2026", "09"], { category: "agents-coding" }),
    (error) => error === missing,
  );
});

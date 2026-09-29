import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";

const noStore = jest.fn();
jest.unstable_mockModule("next/cache", () => ({ unstable_noStore: noStore }));
const { DataUnavailableError, availableData, unavailableResponse } =
  await import("../lib/data-availability.ts");
const fail = async () => {
  throw new DataUnavailableError();
};
const getStory = jest.fn(fail);
const getRelatedStories = jest.fn(fail);
jest.unstable_mockModule("../lib/data.ts", () => ({
  getLeaderboard: fail,
  getStory,
  getRelatedStories,
  getFeedStories: fail,
  getArchiveMonths: fail,
  getArchiveStories: fail,
  getCategoryCounts: fail,
  getCategoryStories: fail,
  getSitemapStories: fail,
}));
const notFound = new Error("NEXT_HTTP_ERROR_FALLBACK;404");
jest.unstable_mockModule("next/navigation", () => ({
  permanentRedirect: () => {
    throw new Error("Unexpected redirect");
  },
  notFound: () => {
    throw notFound;
  },
  useRouter: () => ({}),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

test("availability keeps empty and missing data distinct from outages and propagates bugs", async () => {
  for (const value of [null, [], {}]) {
    assert.deepEqual(await availableData(async () => value), { available: true, value });
  }
  noStore.mockClear();
  assert.deepEqual(await availableData(fail), { available: false });
  assert.equal(noStore.mock.calls.length, 1);
  const bug = new Error("bug");
  await assert.rejects(
    availableData(async () => {
      throw bug;
    }),
    (error) => error === bug,
  );
});

test("frontend pages render a recoverable outage while invalid routes remain 404", async () => {
  const { DataUnavailable } = await import("../app/data-unavailable.tsx");
  for (const [path, params] of [
    ["../app/[[...path]]/page.tsx", {}],
    ["../app/archive/[[...date]]/page.tsx", {}],
    ["../app/category/[slug]/page.tsx", { slug: "agents-coding" }],
    ["../app/story/[id]/page.tsx", { id: "123" }],
  ]) {
    const { default: Page } = await import(path);
    const element = await Page({
      params: Promise.resolve(params),
      searchParams: Promise.resolve({}),
    });
    assert.equal(element.props.children.type, DataUnavailable, path);
  }
  const { default: Home } = await import("../app/[[...path]]/page.tsx");
  await assert.rejects(
    Home({ params: Promise.resolve({ path: ["missing"] }) }),
    (error) => error === notFound,
  );
});

test("story metadata distinguishes an outage from a missing story; related failures are optional", async () => {
  const { default: Page, generateMetadata } = await import("../app/story/[id]/page.tsx");
  const props = { params: Promise.resolve({ id: "123" }) };
  assert.deepEqual((await generateMetadata(props)).robots, { index: false });
  getStory.mockResolvedValueOnce(null);
  await assert.rejects(Page(props), (error) => error === notFound);
  getStory.mockResolvedValueOnce(null);
  await assert.rejects(generateMetadata(props), (error) => error === notFound);
  getStory.mockResolvedValueOnce({ hn_id: "123", title: "Headline", category: "agents_coding" });
  const element = await Page({ params: Promise.resolve({ id: "headline-123" }) });
  assert.deepEqual(element.props.relatedStories, []);
  assert.equal(element.props.story.hn_id, "123");
});

test("topics and sitemap remain available without database data", async () => {
  const { default: Topics } = await import("../app/topics/page.tsx");
  const element = await Topics();
  assert.ok(element);
  const { default: sitemap } = await import("../app/sitemap.ts");
  const urls = (await sitemap()).map((entry) => entry.url);
  assert.ok(urls.includes("https://hacksnap.live/"));
  assert.ok(urls.includes("https://hacksnap.live/archive"));
});

test("RSS and social images return retryable, uncached 503s during outages", async () => {
  const { GET } = await import("../app/feed.xml/route.ts");
  const { default: Image } = await import("../app/story/[id]/opengraph-image.tsx");
  for (const response of [
    unavailableResponse(),
    await GET(),
    await Image({ params: Promise.resolve({ id: "123" }) }),
  ]) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "Stories are temporarily unavailable");
  }
});

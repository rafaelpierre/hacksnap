import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import { Suspense } from "react";

const noStore = jest.fn();
jest.unstable_mockModule("next/cache", () => ({ unstable_noStore: noStore }));
jest.unstable_mockModule("server-only", () => ({}));
const { DataUnavailableError, availableData, unavailableResponse } =
  await import("../lib/data-availability.ts");
const fail = async () => {
  throw new DataUnavailableError();
};
const getStory = jest.fn(fail);
const getRelatedStories = jest.fn(fail);
jest.unstable_mockModule("../lib/browse-streaming.ts", () => ({
  shouldStreamBrowse: async () => true,
}));
jest.unstable_mockModule("../lib/data.ts", () => ({
  getLeaderboard: fail,
  getMarkdownLeaderboard: fail,
  getStoryMetrics: fail,
  getReadyStoryPage: fail,
  getStory,
  getRelatedStories,
  getFeedStories: fail,
  getRssStories: fail,
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
    ["../app/category/[slug]/page.tsx", { slug: "agents-coding" }],
    ["../app/story/[id]/page.tsx", { id: "123" }],
  ]) {
    const { default: Page } = await import(path);
    const element = await Page({
      params: Promise.resolve(params),
      searchParams: Promise.resolve({}),
    });
    // Initial feeds now defer the required read behind Suspense. Resolve only
    // async server children; client components must remain uninvoked here.
    async function containsOutage(node) {
      if (!node || typeof node !== "object") return false;
      if (Array.isArray(node)) {
        for (const child of node) if (await containsOutage(child)) return true;
        return false;
      }
      if (node.type === DataUnavailable) return true;
      if (node.type?.constructor?.name === "AsyncFunction") {
        return containsOutage(await node.type(node.props));
      }
      return containsOutage(node.props?.children);
    }
    assert.equal(await containsOutage(element), true, path);
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
  getRelatedStories.mockClear();
  const element = await Page({ params: Promise.resolve({ id: "123" }) });
  assert.equal(element.props.relatedSection.type, Suspense);
  assert.equal(getRelatedStories.mock.calls.length, 0);
  assert.equal(element.props.story.hn_id, "123");
});

test("topics and sitemap remain available without database data", async () => {
  const { default: Topics } = await import("../app/topics/page.tsx");
  const element = await Topics();
  assert.ok(element);
  const { default: sitemap } = await import("../app/sitemap.ts");
  const urls = (await sitemap()).map((entry) => entry.url);
  assert.ok(urls.includes("https://hacksnap.live/"));
  assert.ok(urls.every((url) => !url.includes("/archive")));
});

test("RSS and legacy story preview URLs return retryable, uncached 503s during an outage", async () => {
  const { GET } = await import("../app/feed.xml/route.ts");
  const { GET: preview } = await import("../app/story/[id]/opengraph-image/route.ts");
  for (const response of [
    unavailableResponse(),
    await GET(),
    await preview(new Request("https://hacksnap.live/story/123/opengraph-image"), {
      params: Promise.resolve({ id: "123" }),
    }),
  ]) {
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "60");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(await response.text(), "Stories are temporarily unavailable");
  }
});

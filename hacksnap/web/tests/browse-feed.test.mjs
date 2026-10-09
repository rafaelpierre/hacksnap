import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { browsePagination, browseStoriesHandler } from "../lib/browse-feed.ts";
import { validFeedPage, validFeedSnapshot } from "../lib/feed-state.ts";
import { CATEGORIES } from "../lib/categories.ts";

const ready = {
  hn_id: "123",
  title: "Published story",
  url: "https://example.com",
  category: null,
  points: 5,
  comment_count: 2,
  date_added: new Date("2026-09-29T12:00:00Z"),
  summary: { overall_takeaway: "Published brief", sentiment: null, source_coverage: null },
  private_field: "must not be exposed",
};
const request = (query) => new Request(`https://hacksnap.live/api/browse-stories?${query}`);

test("all topic filters and archive months use the existing readers and public projection", async () => {
  const calls = [];
  const result = { stories: [ready], hasNext: true };
  const handler = browseStoriesHandler({
    getArchiveStories: async (...args) => {
      calls.push(args);
      return result;
    },
    getCategoryStories: async (...args) => {
      calls.push(args);
      return result;
    },
  });
  for (const [path, filter] of [
    ["/", null],
    ["/2026/09", "2026-09"],
    ...CATEGORIES.flatMap((category) => [
      [`/category/${category.slug}`, category.id],
      [`/?category=${category.slug}`, category.id],
    ]),
  ]) {
    const response = await handler(request(new URLSearchParams({ path, page: "2" })));
    assert.equal(response.status, 200);
    assert.deepEqual(calls.at(-1), [filter, 2]);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = await response.json();
    assert.ok(validFeedPage(body, path));
    assert.equal(body.stories[0].summary.overall_takeaway, "Published brief");
    assert.equal(body.stories[0].rank, null);
    assert.equal(body.stories[0].private_field, undefined);
    assert.equal(JSON.stringify(body.pagination), JSON.stringify(browsePagination(2, true)));
  }
});

test("browse API delegates normalized page keys while preserving no-store responses", async () => {
  let calls = 0;
  let finish;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  const result = { stories: [ready], hasNext: true };
  const handler = browseStoriesHandler({
    getArchiveStories: async (month, page) => {
      calls++;
      assert.equal(month, null);
      assert.equal(page, 1);
      await gate;
      return result;
    },
    getCategoryStories: async () => ({ stories: [], hasNext: false }),
  });
  const omittedPage = handler(request(new URLSearchParams({ path: "/" })));
  const explicitPage = handler(request(new URLSearchParams({ path: "/", page: "1" })));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);
  finish();
  const [first, second] = await Promise.all([omittedPage, explicitPage]);
  assert.equal(first.headers.get("Cache-Control"), "no-store");
  assert.equal(second.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await first.json(), await second.json());
  assert.equal(calls, 2);
});

test("browse API retries failed data reads", async () => {
  let calls = 0;
  const handler = browseStoriesHandler({
    getArchiveStories: async () => {
      calls++;
      if (calls === 1) throw new Error("private database diagnostic");
      return { stories: [ready], hasNext: false };
    },
    getCategoryStories: async () => ({ stories: [], hasNext: false }),
  });
  const query = new URLSearchParams({ path: "/" });
  const failed = await handler(request(query));
  const recovered = await handler(request(query));
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get("Cache-Control"), "no-store");
  assert.equal(recovered.status, 200);
  assert.equal(calls, 2);
});

test("invalid listing requests fail before data access and failures are sanitized", async () => {
  let calls = 0;
  const fail = async () => {
    calls++;
    throw new Error("private database diagnostic");
  };
  const handler = browseStoriesHandler({ getArchiveStories: fail, getCategoryStories: fail });
  for (const query of [
    "",
    "path=//example.com/archive",
    "path=/category/unknown",
    "path=/2026/13",
    "path=/&page=101",
    "path=/&page=0",
    "path=/&page=2&page=3",
    "path=/&path=/category/agents-coding",
    "path=/&cursor=anything",
    "path=" + encodeURIComponent("/?category=unknown"),
    "path=" + encodeURIComponent("/?category=agents-coding&category=models-products"),
    "path=" + encodeURIComponent("/2026/09?category=agents-coding"),
    "path=" + encodeURIComponent("/?category=agents-coding&page=2"),
  ])
    assert.equal((await handler(request(query))).status, 400, query);
  assert.equal(calls, 0);
  const response = await handler(request("path=/&page=2"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.doesNotMatch(await response.text(), /private database/);
});

test("browse snapshots accept 15 published cards per batch without weakening ranked validation", async () => {
  const handler = browseStoriesHandler({
    getArchiveStories: async () => ({ stories: [ready], hasNext: false }),
    getCategoryStories: async () => ({ stories: [], hasNext: false }),
  });
  const body = await (await handler(request("path=/"))).json();
  const stories = Array.from({ length: 15 }, (_, i) => ({
    ...body.stories[0],
    hn_id: String(i + 1),
  }));
  assert.ok(validFeedPage({ ...body, stories }, "/"));
  assert.equal(
    validFeedPage({ ...body, stories: [...stories, { ...stories[0], hn_id: "16" }] }, "/"),
    null,
  );
  assert.ok(validFeedPage(body));
  const snapshot = {
    version: 3,
    url: "/",
    stories: Array.from({ length: 450 }, (_, i) => ({ ...stories[0], hn_id: String(i + 1) })),
    pagination: browsePagination(30, true),
    scrollY: 1000,
    focusStoryId: "450",
    savedAt: Date.now(),
  };
  assert.ok(validFeedSnapshot(snapshot, "/"));
  assert.equal(validFeedSnapshot(snapshot, "/category/agents-coding"), null);
  assert.equal(validFeedPage({ ...body, pagination: browsePagination(101, false) }, "/"), null);
});

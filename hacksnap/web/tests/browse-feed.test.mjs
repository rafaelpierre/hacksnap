import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { browsePagination, browseStoriesHandler } from "../lib/browse-feed.ts";
import { validFeedPage, validFeedSnapshot } from "../lib/feed-state.ts";
import { CATEGORIES } from "../lib/categories.ts";

const pending = {
  hn_id: "123",
  title: "Pending story",
  url: "https://example.com",
  category: null,
  points: 5,
  comment_count: 2,
  date_added: new Date("2026-09-29T12:00:00Z"),
  summary: null,
  private_field: "must not be exposed",
};
const request = (query) => new Request(`https://hacksnap.live/api/browse-stories?${query}`);

test("all topic filters and archive months use the existing readers and public projection", async () => {
  const calls = [];
  const result = { stories: [pending], hasNext: true };
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
    ["/archive", null],
    ["/archive/2026/09", "2026-09"],
    ...CATEGORIES.map((category) => [`/category/${category.slug}`, category.id]),
  ]) {
    const response = await handler(request(new URLSearchParams({ path, page: "2" })));
    assert.equal(response.status, 200);
    assert.deepEqual(calls.at(-1), [filter, 2]);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = await response.json();
    assert.ok(validFeedPage(body, path));
    assert.equal(body.stories[0].summary, null);
    assert.equal(body.stories[0].rank, null);
    assert.equal(body.stories[0].private_field, undefined);
    assert.equal(JSON.stringify(body.pagination), JSON.stringify(browsePagination(2, true)));
  }
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
    "path=/",
    "path=//example.com/archive",
    "path=/category/unknown",
    "path=/archive/2026/13",
    "path=/archive&page=101",
    "path=/archive&page=0",
    "path=/archive&page=2&page=3",
    "path=/archive&path=/category/agents-coding",
    "path=/archive&cursor=anything",
  ])
    assert.equal((await handler(request(query))).status, 400, query);
  assert.equal(calls, 0);
  const response = await handler(request("path=/archive&page=2"));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "60");
  assert.doesNotMatch(await response.text(), /private database/);
});

test("browse snapshots accept full batches and pending briefs without weakening ranked validation", async () => {
  const handler = browseStoriesHandler({
    getArchiveStories: async () => ({ stories: [pending], hasNext: false }),
    getCategoryStories: async () => ({ stories: [], hasNext: false }),
  });
  const body = await (await handler(request("path=/archive"))).json();
  const stories = Array.from({ length: 30 }, (_, i) => ({
    ...body.stories[0],
    hn_id: String(i + 1),
  }));
  assert.ok(validFeedPage({ ...body, stories }, "/archive"));
  assert.equal(
    validFeedPage({ ...body, stories: [...stories, { ...stories[0], hn_id: "31" }] }, "/archive"),
    null,
  );
  assert.equal(validFeedPage(body), null);
  const snapshot = {
    version: 1,
    url: "/archive",
    stories: Array.from({ length: 450 }, (_, i) => ({ ...stories[0], hn_id: String(i + 1) })),
    pagination: browsePagination(15, true),
    scrollY: 1000,
    focusStoryId: "450",
    savedAt: Date.now(),
  };
  assert.ok(validFeedSnapshot(snapshot, "/archive"));
  assert.equal(validFeedSnapshot(snapshot, "/category/agents-coding"), null);
  assert.equal(
    validFeedPage({ ...body, pagination: browsePagination(101, false) }, "/archive"),
    null,
  );
});

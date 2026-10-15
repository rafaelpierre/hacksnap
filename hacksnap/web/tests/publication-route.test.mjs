import assert from "node:assert/strict";
import { afterEach, expect, jest, test } from "@jest/globals";

const revalidateTag = jest.fn();
const revalidatePath = jest.fn();
const getFreshStory = jest.fn(async (id) => ({
  hn_id: id,
  story_slug: null,
  category: "models_products",
}));
const clearNegativeStories = jest.fn();
const getArchiveStories = jest.fn(async () => ({ stories: [] }));
const getCategoryStories = jest.fn(async () => ({ stories: [] }));
jest.unstable_mockModule("next/cache", () => ({ revalidateTag, revalidatePath }));
jest.unstable_mockModule("../lib/data/stories.ts", () => ({ getFreshStory, clearNegativeStories }));
jest.unstable_mockModule("../lib/data/browse.ts", () => ({
  getArchiveStories,
  getCategoryStories,
}));
const { POST } = await import("../app/api/revalidate-publication/route.ts");
const { PUBLICATION_TAG, POPULARITY_TAG } = await import("../lib/publication-cache.ts");
const originalFetch = globalThis.fetch;
afterEach(() => {
  delete process.env.HACKSNAP_PUBLICATION_SECRET;
  delete process.env.HACKSNAP_PUBLICATION_ORIGIN;
  globalThis.fetch = originalFetch;
  jest.clearAllMocks();
});
function request(changes, warm = false) {
  process.env.HACKSNAP_PUBLICATION_SECRET = "s".repeat(32);
  return new Request("https://example.test/api/revalidate-publication", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + "s".repeat(32),
      ...(warm ? { "X-Hacksnap-Publication-Phase": "warm" } : {}),
    },
    body: JSON.stringify({ changes }),
  });
}
test("ordinary batches use stale tags; withdrawals expire tags and routes once", async () => {
  const changes = [
    { storyId: "123", kind: "publication" },
    { storyId: "123", kind: "image" },
  ];
  assert.equal((await POST(request(changes))).status, 200);
  expect(clearNegativeStories.mock.calls).toEqual([[["123"]]]);
  expect(revalidateTag.mock.calls).toEqual([
    [PUBLICATION_TAG, "max"],
    [POPULARITY_TAG, "max"],
  ]);
  assert.equal(revalidatePath.mock.calls.length, 0);
  jest.clearAllMocks();
  changes.push({ storyId: "456", kind: "removal" });
  assert.equal((await POST(request(changes))).status, 200);
  expect(revalidateTag.mock.calls).toEqual([
    [PUBLICATION_TAG, { expire: 0 }],
    [POPULARITY_TAG, { expire: 0 }],
  ]);
  expect(revalidatePath.mock.calls).toEqual([["/story/[id]", "layout"]]);
});
test("warming derives bounded destinations and returns retryable failure", async () => {
  process.env.HACKSNAP_PUBLICATION_ORIGIN = "https://preview.example.test";
  globalThis.fetch = jest.fn(async () => new Response("ready"));
  const changes = [{ storyId: "123", kind: "correction" }];
  assert.equal((await POST(request(changes, true))).status, 200);
  assert.equal(revalidateTag.mock.calls.length, 0);
  const paths = globalThis.fetch.mock.calls.map(([url]) => url.pathname);
  assert.ok(
    paths.includes("/") &&
      paths.includes("/story/123") &&
      paths.includes("/story/123/opengraph-image"),
  );
  for (const [url, options] of globalThis.fetch.mock.calls) {
    assert.equal(url.origin, "https://preview.example.test");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
  }
  assert.equal(getArchiveStories.mock.calls.length, 1);
  assert.equal(getCategoryStories.mock.calls.length, 1);
  globalThis.fetch.mockImplementation(async () => new Response("unavailable", { status: 503 }));
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    assert.equal((await POST(request(changes, true))).status, 503);
  } finally {
    log.mockRestore();
  }
});

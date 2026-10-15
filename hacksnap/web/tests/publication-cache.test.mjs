import assert from "node:assert/strict";
import { afterEach, jest, test } from "@jest/globals";
import { createHash } from "node:crypto";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external.js";
const { publicationCache, encodeCacheValue, decodeCacheValue } =
  await import("../lib/publication-cache.ts");
let storyValue = null;
let storyReads = 0;
jest.unstable_mockModule("../lib/data/capabilities.ts", () => ({
  readStories: async () => {
    storyReads++;
    return storyValue;
  },
  storyIdentityFields: async () => ({}),
}));
const { getStory, clearNegativeStories } = await import("../lib/data/stories.ts");
const entries = new Map();
let clock = 0;
const incrementalCache = {
  generateSimpleCacheKey: async (key) => createHash("sha256").update(key).digest("hex"),
  async get(key) {
    const item = entries.get(key);
    return item ? { value: item.value, isStale: clock >= item.expires } : null;
  },
  async set(key, value) {
    entries.set(key, { value, expires: clock + value.revalidate * 1000 });
  },
};
async function request(run) {
  const store = { route: "/", incrementalCache, pendingRevalidates: {}, nextFetchId: 1 };
  const value = await workAsyncStorage.run(store, run);
  await Promise.all(Object.values(store.pendingRevalidates));
  return value;
}
const policy = { ttl: () => 60_000, maxEntries: 8, maxPending: 2 };
afterEach(() => {
  delete process.env.HACKSNAP_PUBLICATION_CACHE;
  entries.clear();
  clock = 0;
  clearNegativeStories(["123", "456"]);
  jest.restoreAllMocks();
});
test("independent loader instances reuse Next's shared cache and restore Dates", async () => {
  process.env.HACKSNAP_PUBLICATION_CACHE = "true";
  let reads = 0;
  const load = async () => {
    reads++;
    return { date_added: new Date("2026-10-15"), summary: { generated_at: "2026-10-15" } };
  };
  const first = publicationCache("test", load, policy);
  const second = publicationCache("test", load, policy);
  const a = await request(() => first("all"));
  const b = await request(() => second("all"));
  assert.equal(reads, 1);
  assert.deepEqual(a, b);
  assert.ok(b.date_added instanceof Date);
  assert.equal(b.summary.generated_at, "2026-10-15");
  assert.deepEqual(decodeCacheValue(encodeCacheValue([a])), [a]);
  entries.clear(); // Simulate immediate expiry after a removal.
  await request(() => second("all"));
  assert.equal(reads, 2, "no completed per-instance copy survives shared invalidation");
});
test("failed refresh retains successful data, while a cold failure remains unavailable", async () => {
  process.env.HACKSNAP_PUBLICATION_CACHE = "true";
  let fail = false;
  let reads = 0;
  const cached = publicationCache(
    "outage",
    async () => {
      reads++;
      if (fail) throw new Error("unavailable");
      return ["published"];
    },
    policy,
  );
  await request(() => cached("all"));
  fail = true;
  clock = 86_400_001;
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    assert.deepEqual(await request(() => cached("all")), ["published"]);
    assert.equal(reads, 2);
    assert.equal(entries.size, 1);
    await assert.rejects(
      request(() => cached("cold")),
      /unavailable/,
    );
    assert.equal(entries.size, 1);
  } finally {
    log.mockRestore();
  }
});
test("concurrent misses share bounded work; rollback restores the short local policy", async () => {
  process.env.HACKSNAP_PUBLICATION_CACHE = "true";
  let reads = 0;
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const cached = publicationCache(
    "concurrency",
    async () => {
      reads++;
      await pending;
      return reads;
    },
    policy,
  );
  const a = request(() => cached("a"));
  const b = request(() => cached("a"));
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([a, b]);
  assert.equal(reads, 1);
  delete process.env.HACKSNAP_PUBLICATION_CACHE;
  await cached("a");
  await cached("a");
  assert.equal(reads, 2);
});

test("missing and pending stories expire after sixty seconds and never enter the day-long cache", async () => {
  process.env.HACKSNAP_PUBLICATION_CACHE = "true";
  jest.spyOn(Date, "now").mockImplementation(() => clock);
  for (const [id, initial] of [
    ["123", null],
    ["456", { hn_id: "456", summary: null }],
  ]) {
    storyValue = initial;
    const before = storyReads;
    assert.deepEqual(await request(() => getStory(id)), initial);
    storyValue = { hn_id: id, summary: { overall_takeaway: "Published" } };
    assert.deepEqual(await request(() => getStory(id)), initial);
    assert.equal(storyReads, before + 1);
    clock += 60_001;
    assert.deepEqual(await request(() => getStory(id)), storyValue);
    assert.equal(storyReads, before + 2);
  }
  // A delivered withdrawal expires the shared entry and clears the local negative entry.
  entries.clear();
  clearNegativeStories(["123"]);
  storyValue = null;
  assert.equal(await request(() => getStory("123")), null);
  assert.equal(entries.size, 0);
});

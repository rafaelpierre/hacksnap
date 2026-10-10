import assert from "node:assert/strict";
import { afterAll, beforeEach, jest, test } from "@jest/globals";
import { sitemapRange, sitemapXML } from "../lib/sitemap.ts";

jest.unstable_mockModule("server-only", () => ({}));
jest.unstable_mockModule("next/cache", () => ({ unstable_noStore: () => {} }));
const getSitemapStories = jest.fn(async () => [
  { hn_id: "123", story_slug: null, modified_at: new Date("2026-10-05T12:00:00Z") },
]);
jest.unstable_mockModule("../lib/data.ts", () => ({
  getSitemapStories,
  getSitemapPartitions: async () => [{ id: "0" }, { id: "1" }],
  getArchiveMonths: async () => [{ month: "2026-10" }, { month: "2026-09" }],
}));
const { GET: index } = await import("../app/sitemap.xml/route.ts");
const { GET } = await import("../app/sitemap/[file]/route.ts");
const { DataUnavailableError } = await import("../lib/data-availability.ts");
const shard = (file) =>
  GET(new Request(`https://hacksnap.live/sitemap/${file}`), { params: Promise.resolve({ file }) });
let clock = Date.now();
const now = jest.spyOn(Date, "now").mockImplementation(() => clock);
beforeEach(() => {
  clock += 300_001;
  jest.clearAllMocks();
});
afterAll(() => now.mockRestore());

test("sitemap contains canonical Latest and dated feeds with no legacy archive destinations", async () => {
  const indexXML = await (await index()).text();
  assert.match(indexXML, /<sitemapindex/);
  for (const id of ["pages", "0", "1"]) assert.ok(indexXML.includes(`/sitemap/${id}.xml`));
  const xml = (await (await shard("pages.xml")).text()) + (await (await shard("0.xml")).text());
  const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  assert.ok(urls.includes("https://hacksnap.live/"));
  assert.ok(urls.includes("https://hacksnap.live/2026/10"));
  assert.ok(urls.includes("https://hacksnap.live/2026/09"));
  assert.ok(urls.includes("https://hacksnap.live/story/123"));
  assert.ok(urls.some((url) => url.includes("?category=")));
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.every((url) => !url.includes("/archive")));
});

test("generation coalesces requests, caches XML, and hard expires", async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => shard("0.xml")));
  assert.ok(results.every((response) => response.status === 200));
  assert.equal(getSitemapStories.mock.calls.length, 1);
  await shard("0.xml");
  assert.equal(getSitemapStories.mock.calls.length, 1);
  clock += 300_001;
  await shard("0.xml");
  assert.equal(getSitemapStories.mock.calls.length, 2);
});

test("generation budget bounds distinct partitions and releases after rejection", async () => {
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  getSitemapStories.mockImplementationOnce(async () => {
    await held;
    throw new DataUnavailableError();
  });
  getSitemapStories.mockImplementationOnce(async () => {
    await held;
    return [];
  });
  const work = [shard("0.xml"), shard("1.xml")];
  const busy = await shard("2.xml");
  assert.equal(busy.status, 503);
  assert.equal(busy.headers.get("cache-control"), "no-store");
  assert.equal(busy.headers.get("retry-after"), "60");
  assert.equal(getSitemapStories.mock.calls.length, 2);
  release();
  const results = await Promise.all(work);
  assert.deepEqual(
    results.map((response) => response.status),
    [503, 200],
  );
  assert.equal((await shard("0.xml")).status, 200);
});

test("malformed partitions never load data; ranges and XML are bounded", async () => {
  for (const file of ["-1.xml", "01.xml", "100000000000.xml", "1.5.xml", "index.xml", "0.json"])
    assert.equal((await shard(file)).status, 404);
  assert.equal(getSitemapStories.mock.calls.length, 0);
  assert.deepEqual(sitemapRange("0"), [0, 10000]);
  assert.deepEqual(sitemapRange("1"), [10000, 20000]);
  assert.deepEqual(sitemapRange("99999999999"), [999999999990000, 1000000000000000]);
  assert.match(
    sitemapXML([{ url: 'https://example.com/?a=1&b="<x>"' }]),
    /&amp;b=&quot;&lt;x&gt;&quot;/,
  );
  assert.throws(() => sitemapXML(Array(50001).fill({ url: "https://example.com" })));
});

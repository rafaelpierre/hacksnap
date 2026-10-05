import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";

jest.unstable_mockModule("next/cache", () => ({ unstable_noStore: () => {} }));
jest.unstable_mockModule("../lib/data.ts", () => ({
  getSitemapStories: async () => [
    { hn_id: "123", story_slug: null, modified_at: new Date("2026-10-05T12:00:00Z") },
  ],
  getArchiveMonths: async () => [{ month: "2026-10" }, { month: "2026-09" }],
}));
const { default: sitemap } = await import("../app/sitemap.ts");

test("sitemap contains canonical Latest and dated feeds with no legacy archive destinations", async () => {
  const urls = (await sitemap()).map((entry) => entry.url);
  assert.ok(urls.includes("https://hacksnap.live/"));
  assert.ok(urls.includes("https://hacksnap.live/2026/10"));
  assert.ok(urls.includes("https://hacksnap.live/2026/09"));
  assert.ok(urls.includes("https://hacksnap.live/story/123"));
  assert.ok(urls.some((url) => url.includes("/category/")));
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(urls.every((url) => !url.includes("/archive")));
});

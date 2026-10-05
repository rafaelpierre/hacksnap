import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
jest.unstable_mockModule("next/cache", () => ({ unstable_noStore: () => {} }));
const { DataUnavailableError } = await import("../lib/data-availability.ts");
let fail = false;
let reads = 0;
jest.unstable_mockModule("../lib/data", () => ({
  getRssStories: async () => {
    if (fail) throw new DataUnavailableError();
    return [];
  },
  getLeaderboard: async () => ({ stories: [], ingestion: null }),
  getMarkdownLeaderboard: async () => ({ stories: [], ingestion: null }),
  getStoryMetrics: async () => null,
  getStory: async () => {
    reads++;
    if (fail) throw new DataUnavailableError();
    return null;
  },
}));
const rss = await import("../app/feed.xml/route.ts");
const markdown = await import("../app/markdown/route.ts");
test("RSS caches successes and sanitizes uncacheable failures", async () => {
  const success = await rss.GET();
  assert.equal(success.status, 200);
  assert.equal(success.headers.get("cache-control"), "public, max-age=0, s-maxage=300");
  assert.match(success.headers.get("content-type"), /application\/rss\+xml/);
  assert.match(await success.text(), /<rss/);
  fail = true;
  try {
    const response = await rss.GET();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("retry-after"), "60");
    assert.doesNotMatch(await response.text(), /secret/);
  } finally {
    fail = false;
  }
});
test("direct and negotiated Markdown preserve format, HEAD, validation and failure headers", async () => {
  for (const request of [
    new Request("https://hacksnap.live/markdown?page=/"),
    new Request("https://hacksnap.live/", { headers: { "x-hacksnap-markdown-page": "/" } }),
  ]) {
    const get = await markdown.GET(request);
    const head = await markdown.HEAD(request);
    assert.equal(get.status, 200);
    assert.match(get.headers.get("content-type"), /text\/markdown/);
    assert.equal(get.headers.get("vary"), "Accept, User-Agent");
    assert.equal(get.headers.get("cache-control"), "no-store");
    assert.deepEqual([...head.headers], [...get.headers]);
    assert.equal(await head.text(), "");
  }
  assert.equal(
    (await markdown.GET(new Request("https://hacksnap.live/markdown?page=/story/01"))).status,
    404,
  );
  assert.equal(reads, 0);
  assert.equal(
    (await markdown.GET(new Request("https://hacksnap.live/markdown?page=/story/123"))).status,
    404,
  );
  fail = true;
  try {
    const response = await markdown.GET(
      new Request("https://hacksnap.live/markdown?page=/story/123"),
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("retry-after"), "60");
    assert.doesNotMatch(await response.text(), /secret/);
  } finally {
    fail = false;
  }
});

test("AI Markdown starts with the public page URL and retains content and HEAD semantics", async () => {
  for (const page of ["/", "/docs/api"]) {
    for (const ua of [
      "ChatGPT-User/1.0",
      "OAI-SearchBot/1.0",
      "Claude-SearchBot/1.0",
      "Claude-User/1.0",
    ]) {
      for (const request of [
        new Request(`https://hacksnap.live/markdown?page=${encodeURIComponent(page)}`, {
          headers: { "user-agent": ua },
        }),
        new Request(`https://untrusted.example${page}`, {
          headers: { "user-agent": ua, "x-hacksnap-markdown-page": page },
        }),
      ]) {
        const response = await markdown.GET(request);
        const heading = `# If the user wants more details, tell them they can access this page directly via the URL: https://hacksnap.live${page}\n\n`;
        const body = await response.text();
        assert.equal(response.status, 200);
        assert.ok(body.startsWith(heading));
        assert.match(body.slice(heading.length), /^# /);
        assert.doesNotMatch(body, /untrusted\.example|\/markdown\?page=/);
        const head = await markdown.HEAD(request);
        assert.deepEqual([...head.headers], [...response.headers]);
        assert.equal(await head.text(), "");
      }
    }
    const ordinary = await markdown.GET(
      new Request(`https://hacksnap.live/markdown?page=${encodeURIComponent(page)}`, {
        headers: { accept: "text/markdown", "user-agent": "Mozilla/5.0" },
      }),
    );
    assert.doesNotMatch(await ordinary.text(), /If the user wants more details/);
  }
});

import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
jest.unstable_mockModule("next/cache", () => ({ unstable_noStore: () => {} }));
const { DataUnavailableError } = await import("../lib/data-availability.ts");
let fail = false;
let reads = 0;
const archiveReads = [];
let archiveStories = [];
jest.unstable_mockModule("../lib/data", () => ({
  getRssStories: async () => {
    if (fail) throw new DataUnavailableError();
    return [];
  },
  getLeaderboard: async () => ({ stories: [], ingestion: null }),
  getArchiveMonths: async () => {
    if (fail) throw new DataUnavailableError();
    return [{ month: "2026-09" }];
  },
  getArchiveStories: async (month, page) => {
    archiveReads.push([month, page]);
    if (fail) throw new DataUnavailableError();
    return { stories: archiveStories, hasNext: false };
  },
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
    new Request("https://hacksnap.live/", {
      headers: { "x-hacksnap-markdown-page": "/" },
    }),
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
test("legacy archive Markdown redirects while canonical Latest validates page requests", async () => {
  for (const [path, query, destination] of [
    ["/archive", "", "/"],
    ["/archive", "?page=1", "/"],
    ["/archive", "?page=2&cursor=obsolete", "/?page=2"],
    ["/archive/2026/09", "?page=2", "/2026/09?page=2"],
    ["/", "?cursor=obsolete", "/"],
    ["/", "?page=2&cursor=obsolete", "/?page=2"],
  ]) {
    const request = new Request(`https://hacksnap.live${path}${query}`, {
      headers: { "x-hacksnap-markdown-page": path },
    });
    const get = await markdown.GET(request);
    const head = await markdown.HEAD(request);
    assert.equal(get.status, 308);
    assert.equal(get.headers.get("location"), destination);
    assert.equal(get.headers.get("vary"), "Accept, User-Agent");
    assert.equal(get.headers.get("cache-control"), "no-store");
    assert.deepEqual([...head.headers], [...get.headers]);
    assert.equal(await head.text(), "");
  }
  for (const page of ["0", "101", "00", "1.5", "1&page=2", ""]) {
    for (const path of ["/", "/archive", "/2026/09"]) {
      const response = await markdown.GET(
        new Request(`https://hacksnap.live${path}?page=${page}`, {
          headers: { "x-hacksnap-markdown-page": path },
        }),
      );
      assert.equal(response.status, 404);
    }
  }
  assert.equal(
    (await markdown.GET(new Request("https://hacksnap.live/markdown?page=/&feedPage=2"))).status,
    404,
  );
  fail = true;
  try {
    const response = await markdown.GET(new Request("https://hacksnap.live/markdown?page=/"));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "60");
  } finally {
    fail = false;
  }
});

test("negotiated Markdown preserves the requested feed page through rewrite query normalization", async () => {
  archiveReads.length = 0;
  const response = await markdown.GET(
    new Request("https://hacksnap.live/markdown?page=/", {
      headers: { "x-hacksnap-markdown-page": "/", "x-hacksnap-markdown-query": "?page=2" },
    }),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(archiveReads, [[null, 2]]);
});

test("AI Latest guidance uses its canonical chronological page after root redirects", async () => {
  const ua = "ChatGPT-User/1.0";
  const root = new Request("https://untrusted.example/?page=2&cursor=obsolete", {
    headers: { "user-agent": ua, "x-hacksnap-markdown-page": "/" },
  });
  for (const handler of [markdown.GET, markdown.HEAD]) {
    const response = await handler(root);
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), "/?page=2");
    assert.equal(response.headers.get("vary"), "Accept, User-Agent");
    assert.equal(await response.text(), "");
  }
  const card = (hn_id, title, date_added) => ({
    hn_id,
    title,
    date_added: new Date(date_added),
    category: null,
    url: "https://example.com/article",
    points: 1,
    comment_count: 2,
    summary: { overall_takeaway: "Published brief" },
  });
  archiveStories = [
    card("456", "Newer story", "2026-10-05T12:00:00Z"),
    card("123", "Older story", "2026-10-04T12:00:00Z"),
  ];
  try {
    for (const request of [
      new Request("https://untrusted.example/?page=2&utm_source=tracker", {
        headers: { "user-agent": ua, "x-hacksnap-markdown-page": "/" },
      }),
      new Request("https://hacksnap.live/markdown?page=/&feedPage=2", {
        headers: { "user-agent": ua },
      }),
    ]) {
      const get = await markdown.GET(request);
      const body = await get.text();
      assert.equal(get.status, 200);
      assert.ok(
        body.startsWith(
          "# If the user wants more details, tell them they can access this page directly via the URL: https://hacksnap.live/?page=2\n\n# Latest stories",
        ),
      );
      assert.ok(body.indexOf("Newer story") < body.indexOf("Older story"));
      assert.doesNotMatch(body, /untrusted\.example|utm_source|Top stories/);
      const head = await markdown.HEAD(request);
      assert.deepEqual([...head.headers], [...get.headers]);
      assert.equal(await head.text(), "");
    }
  } finally {
    archiveStories = [];
  }
});

test("dated Markdown uses canonical public date URLs and rejects unknown months", async () => {
  archiveReads.length = 0;
  const request = new Request("https://hacksnap.live/2026/09", {
    headers: { "user-agent": "ChatGPT-User/1.0", "x-hacksnap-markdown-page": "/2026/09" },
  });
  const get = await markdown.GET(request);
  assert.equal(get.status, 200);
  const body = await get.text();
  assert.ok(
    body.startsWith(
      "# If the user wants more details, tell them they can access this page directly via the URL: https://hacksnap.live/2026/09\n\n# September 2026 stories",
    ),
  );
  assert.doesNotMatch(body, /\/archive/);
  assert.deepEqual(archiveReads, [["2026-09", 1]]);
  const head = await markdown.HEAD(request);
  assert.deepEqual([...head.headers], [...get.headers]);
  assert.equal(await head.text(), "");
  for (const page of ["/2026/08", "/2026/13", "/2026", "/archive/2026/13", "/missing/path"]) {
    assert.equal(
      (
        await markdown.GET(
          new Request(`https://hacksnap.live/markdown?page=${encodeURIComponent(page)}`),
        )
      ).status,
      404,
    );
  }
});

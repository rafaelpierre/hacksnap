import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";

const story = {
  hn_id: "123",
  title: "Readable headline",
  story_slug: "readable-headline-123",
  category: null,
  summary: null,
  date_added: new Date("2026-09-29T12:00:00Z"),
  points: 1,
  comment_count: 0,
  url: null,
};
const getStory = jest.fn(async () => story);
jest.unstable_mockModule("../lib/data.ts", () => ({
  getStory,
  getRelatedStories: async () => [],
  getLeaderboard: async () => ({ stories: [], ingestion: null }),
  getMarkdownLeaderboard: async () => ({ stories: [], ingestion: null }),
  getStoryMetrics: async () => null,
}));
jest.unstable_mockModule("next/cache", () => ({ unstable_noStore: () => {} }));
const missing = new Error("not found");
jest.unstable_mockModule("next/navigation", () => ({
  notFound: () => {
    throw missing;
  },
  permanentRedirect: (url) => {
    throw Object.assign(new Error("redirect"), { url });
  },
  usePathname: () => "/",
  useRouter: () => ({}),
}));
const { default: Page, generateMetadata } = await import("../app/story/[id]/page.tsx");
const { GET, HEAD } = await import("../app/markdown/route.ts");
const props = (id) => ({ params: Promise.resolve({ id }) });
const request = (id) =>
  new Request(`https://hacksnap.live/markdown?page=${encodeURIComponent(`/story/${id}`)}`);

test("HTML redirects legacy and stale URLs and renders the canonical story", async () => {
  for (const slug of ["123", "old-title-123"]) {
    await assert.rejects(
      Page(props(slug)),
      (error) => error.url === "/story/readable-headline-123",
    );
  }
  assert.equal((await Page(props("readable-headline-123"))).props.story, story);
  assert.equal(
    (await generateMetadata(props("readable-headline-123"))).alternates.canonical,
    "https://hacksnap.live/story/readable-headline-123",
  );
  assert.equal(getStory.mock.calls.at(-1)[0], "123");
  getStory.mockClear();
  await assert.rejects(Page(props("invalid")), (error) => error === missing);
  await assert.rejects(generateMetadata(props("invalid")), (error) => error === missing);
  assert.equal(getStory.mock.calls.length, 0);
  getStory.mockResolvedValueOnce(null);
  await assert.rejects(Page(props("missing-999")), (error) => error === missing);
});

test("Markdown and HEAD preserve canonical redirects, content and missing status", async () => {
  for (const handler of [GET, HEAD]) {
    for (const slug of ["123", "old-title-123"]) {
      const response = await handler(request(slug));
      assert.equal(response.status, 308);
      assert.equal(response.headers.get("location"), "/story/readable-headline-123");
      assert.equal(response.headers.get("vary"), "Accept");
    }
    const response = await handler(request("readable-headline-123"));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/markdown/);
    if (handler === GET) assert.match(await response.text(), /Readable headline/);
    else assert.equal(await response.text(), "");
    getStory.mockClear();
    assert.equal((await handler(request("invalid"))).status, 404);
    assert.equal(getStory.mock.calls.length, 0);
    getStory.mockResolvedValueOnce(null);
    assert.equal((await handler(request("missing-999"))).status, 404);
  }
});

test("legacy HTML redirects retain navigation context and repeated query values", async () => {
  await assert.rejects(
    Page({
      ...props("123"),
      searchParams: Promise.resolve({ journey: "saved-token", source: ["one", "two"] }),
    }),
    (error) =>
      error.url === "/story/readable-headline-123?journey=saved-token&source=one&source=two",
  );
});

test("existing numeric stories render directly and reject invented canonical slugs", async () => {
  const legacy = { ...story, story_slug: null, title: "Updated old headline" };
  getStory.mockResolvedValueOnce(legacy);
  assert.equal((await Page(props("123"))).props.story, legacy);
  getStory.mockResolvedValueOnce(legacy);
  assert.equal(
    (await generateMetadata(props("123"))).alternates.canonical,
    "https://hacksnap.live/story/123",
  );
  getStory.mockResolvedValueOnce(legacy);
  await assert.rejects(Page(props("invented-slug-123")), (error) => error.url === "/story/123");
  for (const handler of [GET, HEAD]) {
    getStory.mockResolvedValueOnce(legacy);
    assert.equal((await handler(request("123"))).status, 200);
    getStory.mockResolvedValueOnce(legacy);
    assert.equal(
      (await handler(request("invented-slug-123"))).headers.get("location"),
      "/story/123",
    );
  }
});

test("new stories keep their first saved slug after headline edits", async () => {
  const edited = { ...story, title: "A later title" };
  getStory.mockResolvedValueOnce(edited);
  assert.equal((await Page(props("readable-headline-123"))).props.story.title, "A later title");
  getStory.mockResolvedValueOnce(edited);
  assert.equal(
    (await generateMetadata(props("123"))).alternates.canonical,
    "https://hacksnap.live/story/readable-headline-123",
  );
});

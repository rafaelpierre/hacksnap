import assert from "node:assert/strict";
import { expect, jest, test } from "@jest/globals";

const blobURL =
  "https://caiasssg5nuaa1i1.public.blob.vercel-storage.com/articles/123/hero-a1b2c3.webp";
const getStory = jest.fn();
const ogImage = jest.fn(
  () => new Response("story card", { headers: { "content-type": "image/png" } }),
);
jest.unstable_mockModule("../lib/data.ts", () => ({ getStory }));
jest.unstable_mockModule("next/cache", () => ({ unstable_noStore: () => {} }));
jest.unstable_mockModule("../lib/og-image.tsx", () => ({ ogImage }));
const { GET } = await import("../app/story/[id]/opengraph-image/route.ts");

const request = new Request("https://hacksnap.live/story/123/opengraph-image");
const params = { params: Promise.resolve({ id: "123" }) };
const ready = {
  hn_id: "123",
  title: "Small models on everyday hardware",
  url: "https://www.example.com/article",
  summary: { overall_takeaway: "Small models can run locally with less memory." },
  image_url: blobURL,
  image_status: "ready",
  image_width: 1200,
  image_height: 630,
  image_mime_type: "image/webp",
};

test("story previews render the title and takeaway regardless of stored image availability", async () => {
  for (const image_status of ["ready", "pending", "failed", null]) {
    getStory.mockResolvedValueOnce({ ...ready, image_status });
    const response = await GET(request, params);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.match(response.headers.get("content-type") ?? "", /image\/png/);
    expect(ogImage).toHaveBeenLastCalledWith({
      title: ready.title,
      source: "example.com",
      takeaway: ready.summary.overall_takeaway,
    });
  }
});

test("slugged preview URLs resolve the story ID and handle a pending summary", async () => {
  getStory.mockResolvedValueOnce({
    ...ready,
    url: "https://news.ycombinator.com/item?id=123",
    summary: null,
  });
  const response = await GET(request, { params: Promise.resolve({ id: "small-models-123" }) });
  assert.equal(response.status, 200);
  expect(getStory).toHaveBeenLastCalledWith("123");
  expect(ogImage).toHaveBeenLastCalledWith({
    title: ready.title,
    source: "Hacker News",
    takeaway: undefined,
  });
});

test("story preview URLs reject malformed and missing IDs without rendering a generic card", async () => {
  ogImage.mockClear();
  const invalid = await GET(request, { params: Promise.resolve({ id: "not-an-id" }) });
  assert.equal(invalid.status, 404);
  getStory.mockResolvedValueOnce(null);
  assert.equal((await GET(request, params)).status, 404);
  assert.equal(ogImage.mock.calls.length, 0);
});

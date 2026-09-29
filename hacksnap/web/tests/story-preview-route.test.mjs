import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";

const blobURL = "https://store-id.public.blob.vercel-storage.com/articles/123/hero-a1b2c3.webp";
const getStory = jest.fn();
jest.unstable_mockModule("../lib/data.ts", () => ({ getStory }));
jest.unstable_mockModule("next/cache", () => ({ unstable_noStore: () => {} }));
jest.unstable_mockModule("../lib/og-image.tsx", () => ({
  ogImage: () => new Response("brand card", { headers: { "content-type": "image/png" } }),
}));
const { GET } = await import("../app/story/[id]/opengraph-image/route.ts");

const request = new Request("https://hacksnap.live/story/123/opengraph-image");
const params = { params: Promise.resolve({ id: "123" }) };
const ready = {
  hn_id: "123",
  image_url: blobURL,
  image_status: "ready",
  image_width: 1200,
  image_height: 630,
  image_mime_type: "image/webp",
};

test("legacy story preview URLs redirect to a ready canonical Blob asset", async () => {
  getStory.mockResolvedValueOnce(ready);
  const response = await GET(request, params);
  assert.equal(response.status, 307);
  assert.equal(response.headers.get("location"), blobURL);
});

test("legacy story preview URLs retain the branded card for unavailable assets", async () => {
  for (const image_status of ["pending", "failed", null]) {
    getStory.mockResolvedValueOnce({ ...ready, image_status });
    const response = await GET(request, params);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /image\/png/);
  }
});

test("legacy story preview URLs reject malformed and missing IDs", async () => {
  const invalid = await GET(request, { params: Promise.resolve({ id: "not-an-id" }) });
  assert.equal(invalid.status, 404);
  getStory.mockResolvedValueOnce(null);
  assert.equal((await GET(request, params)).status, 404);
});

import assert from "node:assert/strict";
import { afterAll, jest, test } from "@jest/globals";
jest.unstable_mockModule("server-only", () => ({}));
const { publicationWebhook } = await import("../lib/publication-webhook.ts");
const previous = process.env.HACKSNAP_PUBLICATION_SECRET;
process.env.HACKSNAP_PUBLICATION_SECRET = "s".repeat(32);
afterAll(() => {
  if (previous === undefined) delete process.env.HACKSNAP_PUBLICATION_SECRET;
  else process.env.HACKSNAP_PUBLICATION_SECRET = previous;
});
function request(body, token = "s".repeat(32)) {
  return new Request("https://example.test/api/revalidate-publication", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}
const change = { storyId: "123", kind: "publication" };
test("authenticated duplicate deliveries are accepted; arbitrary tags, URLs and oversized batches are rejected", async () => {
  const notify = jest.fn(async () => {});
  const post = publicationWebhook(notify);
  assert.equal((await post(request({ changes: [change] }, "wrong"))).status, 401);
  for (const body of [
    { tags: ["anything"] },
    { changes: [change], url: "https://example.test" },
    { changes: [] },
    { changes: Array(33).fill(change) },
    { changes: [{ storyId: "../123", kind: "publication" }] },
    { changes: [{ ...change, kind: "other" }] },
    { changes: [{ ...change, url: "/" }] },
  ])
    assert.equal((await post(request(body))).status, 400);
  assert.equal((await post(request({ changes: [change], padding: "x".repeat(8192) }))).status, 413);
  assert.equal(notify.mock.calls.length, 0);
  for (let n = 0; n < 2; n++) {
    const response = await post(request({ changes: [change] }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal(notify.mock.calls.length, 2);
});
test("failed invalidation is retryable", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const post = publicationWebhook(async () => {
      throw new Error("database unavailable");
    });
    assert.equal((await post(request({ changes: [change] }))).status, 503);
  } finally {
    log.mockRestore();
  }
});

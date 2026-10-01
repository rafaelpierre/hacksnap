import assert from "node:assert/strict";
import { expect, jest, test } from "@jest/globals";

let unavailable = false;
jest.unstable_mockModule("../lib/data.ts", () => ({
  getCurrentReadySelectionIds: async () => {
    if (unavailable) throw new Error("private database detail");
    return ["1", "2", "3"];
  },
}));

const { GET } = await import("../app/api/story-freshness/route.ts");

test("freshness endpoint returns bounded selection IDs with no HTTP cache", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  expect(await response.json()).toEqual({ ids: ["1", "2", "3"] });
});

test("freshness endpoint handles unavailable data without leaking details", async () => {
  unavailable = true;
  try {
    const response = await GET();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("retry-after"), "60");
    expect(await response.json()).toEqual({ error: "Story updates are temporarily unavailable" });
  } finally {
    unavailable = false;
  }
});

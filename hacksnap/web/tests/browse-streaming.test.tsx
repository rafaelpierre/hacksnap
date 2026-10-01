import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";

let destinationHeader: string | null = null;

jest.unstable_mockModule("next/headers", () => ({
  headers: async () => ({
    get: (name: string) => (name === "sec-fetch-dest" ? destinationHeader : null),
  }),
}));

const { shouldStreamBrowse } = await import("../lib/browse-streaming.ts");

test("stream browse content only for client router requests", async () => {
  destinationHeader = "empty";
  assert.equal(await shouldStreamBrowse(), true);

  destinationHeader = null;
  assert.equal(await shouldStreamBrowse(), false);

  destinationHeader = "document";
  assert.equal(await shouldStreamBrowse(), false);
});

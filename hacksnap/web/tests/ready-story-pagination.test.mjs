import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";

jest.unstable_mockModule("server-only", () => ({}));
const {
  READY_STORY_CURSOR_TTL_MS,
  ReadyStoryPageError,
  assertReadyStoryPage,
  assertReadyStoryPageSize,
  createReadyStoryCursor,
  parseReadyStoryCursor,
} = await import("../lib/ready-story-pagination.ts");

const now = Date.parse("2026-09-29T12:00:00.000Z");
const items = [
  { hn_id: "100", rank: "2", is_recent: true },
  { hn_id: "99", rank: "5", is_recent: false },
];

function cursor(overrides = {}) {
  return createReadyStoryCursor({
    items,
    offset: 1,
    pageSize: 1,
    observedAt: "2026-09-29T11:59:00.000Z",
    ingestion: "2026-09-29T11:30:00.000Z",
    selectionLimited: false,
    expiresAt: new Date(now + READY_STORY_CURSOR_TTL_MS),
    ...overrides,
  });
}

test("ready-story cursor round-trips as a portable frozen selection", () => {
  const encoded = cursor();
  const parsed = parseReadyStoryCursor(encoded, now);
  assert.deepEqual(parsed.items, items);
  assert.equal(parsed.offset, 1);
  assert.equal(parsed.pageSize, 1);
  assert.equal(parsed.ingestion, "2026-09-29T11:30:00.000Z");
  assert.equal(parsed.observedAt, "2026-09-29T11:59:00.000Z");
  assert.equal(parsed.selectionLimited, false);
  assert.equal(parsed.expiresAt, "2026-09-29T20:00:00.000Z");
  assert.ok(encoded.length < 6000);
});

test("ready-story pagination rejects malformed selections, invalid inputs and expiry", () => {
  for (const value of [0, -1, 1.1, 11, Number.NaN])
    assert.throws(() => assertReadyStoryPageSize(value), ReadyStoryPageError);
  for (const value of [0, -1, 1.1, Number.NaN])
    assert.throws(() => assertReadyStoryPage(value), ReadyStoryPageError);
  assert.equal(assertReadyStoryPageSize(undefined), 10);
  assert.equal(assertReadyStoryPage(undefined), 1);

  assert.throws(
    () =>
      cursor({
        items: [
          { hn_id: "100", rank: "2", is_recent: true },
          { hn_id: "100", rank: "3", is_recent: true },
        ],
      }),
    ReadyStoryPageError,
  );
  assert.throws(
    () =>
      cursor({
        items: [
          { hn_id: "100", rank: "3", is_recent: true },
          { hn_id: "99", rank: "2", is_recent: false },
        ],
      }),
    ReadyStoryPageError,
  );
  assert.throws(() => parseReadyStoryCursor("not/a/cursor", now), ReadyStoryPageError);
  assert.throws(
    () => parseReadyStoryCursor(cursor({ expiresAt: new Date(now - 1) }), now),
    (error) => error instanceof ReadyStoryPageError && error.code === "snapshot_expired",
  );
});

test("cursor rejects invalid sizes, unaligned offsets and the ambiguous legacy version", () => {
  for (const pageSize of [0, 11, -1, 1.5, Number.NaN]) {
    assert.throws(() => cursor({ pageSize }), ReadyStoryPageError);
  }
  assert.throws(() => cursor({ pageSize: 2, offset: 1 }), ReadyStoryPageError);
  const bytes = Buffer.from(cursor(), "base64url");
  for (const pageSize of [0, 11, 2]) {
    const malformed = Buffer.from(bytes);
    malformed[18] = pageSize;
    assert.throws(
      () => parseReadyStoryCursor(malformed.toString("base64url"), now),
      (error) => error instanceof ReadyStoryPageError && error.code === "invalid_cursor",
    );
  }
  const legacy = Buffer.concat([bytes.subarray(0, 18), bytes.subarray(19)]);
  legacy[0] = 1;
  assert.throws(
    () => parseReadyStoryCursor(legacy.toString("base64url"), now),
    (error) => error instanceof ReadyStoryPageError && error.code === "invalid_cursor",
  );
});

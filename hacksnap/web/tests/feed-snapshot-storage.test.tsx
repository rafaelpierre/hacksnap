import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import {
  MAX_FEED_SNAPSHOT_BYTES,
  readFeedSnapshot,
  saveFeedSnapshot,
  positionFeedSnapshot,
} from "../lib/feed-snapshot-storage";
import { packFeedSnapshot, unpackFeedSnapshot, type FeedSnapshot } from "../lib/feed-state";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

function snapshot(count: number, page: number, savedAt = Date.now()): FeedSnapshot {
  return {
    version: 1,
    url: "/archive",
    stories: Array.from({ length: count }, (_, index) => ({
      hn_id: String(index + 1),
      story_slug: `story-${index + 1}`,
      title: `A representative Hacker News story ${index + 1}`,
      category: "agents_coding" as const,
      url: `https://example.com/articles/${index + 1}`,
      points: 100,
      comment_count: 20,
      date_added: "2026-09-29T12:00:00.000Z",
      rank: null,
      is_recent: false,
      rank_history: [],
      image_url: null,
      image_status: null,
      image_width: null,
      image_height: null,
      image_mime_type: null,
      summary: {
        overall_takeaway: `A concise but realistic summary for story ${index + 1}.`,
        sentiment: 0 as const,
        source_coverage: {
          stored_comments: 20,
          included_comments: 10,
          comments_truncated: false,
          article_status: "fetched" as const,
        },
      },
    })),
    pagination: {
      cursor: null,
      previousCursor: null,
      hasMore: page < 100,
      page,
      expiresAt: null,
      selectionLimited: false,
    },
    scrollY: 8500,
    focusStoryId: null,
    savedAt,
  };
}

test("compact deep feed stays inside the per-snapshot budget and round-trips", () => {
  const deep = snapshot(3000, 100);
  const packed = packFeedSnapshot(deep);
  assert.ok(packed.length * 2 < MAX_FEED_SNAPSHOT_BYTES);
  assert.ok(packed.length < JSON.stringify(deep).length);
  assert.deepEqual(unpackFeedSnapshot(packed, "/archive"), deep);
  assert.equal(unpackFeedSnapshot(packed, "/category/agents-coding"), null);
  const corrupted = JSON.parse(packed);
  corrupted[2][100][16][2][0] = -1;
  assert.equal(unpackFeedSnapshot(JSON.stringify(corrupted), "/archive"), null);
  if (process.env.MEASURE_FEED_SNAPSHOTS === "1") {
    for (const count of [100, 1000, 3000]) {
      const candidate = snapshot(count, Math.ceil(count / 30));
      const start = performance.now();
      const oldJSON = JSON.stringify(candidate);
      const oldMs = performance.now() - start;
      const packedStart = performance.now();
      const encoded = packFeedSnapshot(candidate);
      const packMs = performance.now() - packedStart;
      const readStart = performance.now();
      unpackFeedSnapshot(encoded, "/archive");
      const readMs = performance.now() - readStart;
      process.stdout.write(
        `feed ${count}: original=${oldJSON.length * 2}B/${oldMs.toFixed(2)}ms compact=${encoded.length * 2}B pack=${packMs.toFixed(2)}ms restore=${readMs.toFixed(2)}ms\n`,
      );
    }
  }
});

test("one tab-level record reconstructs earlier feed depths with exact pagination and focus", () => {
  const dom = new JSDOM("", { url: "https://hacksnap.live/archive" });
  const before = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
  try {
    const early = snapshot(1000, 34, Date.now() - 1000);
    const first = saveFeedSnapshot(early, null)!;
    const positioned = positionFeedSnapshot(first, "/archive", 4800, "800")!;
    const later = snapshot(3000, 100, early.savedAt + 1);
    const writeStart = performance.now();
    const latest = saveFeedSnapshot(later, first)!;
    const writeMs = performance.now() - writeStart;
    assert.equal(latest.id, first.id);
    assert.equal(JSON.stringify(positioned).length < 1000, true);
    const keys = Array.from({ length: dom.window.sessionStorage.length }, (_, index) =>
      dom.window.sessionStorage.key(index),
    );
    assert.equal(keys.filter((key) => key?.startsWith("hacksnap:feed-snapshot:")).length, 1);
    const restored = readFeedSnapshot(positioned, "/archive")!;
    if (process.env.MEASURE_FEED_SNAPSHOTS === "1")
      process.stdout.write(`session storage write 3000=${writeMs.toFixed(2)}ms\n`);
    assert.equal(restored.stories.length, 1000);
    assert.equal(restored.pagination.page, 34);
    assert.equal(restored.focusStoryId, "800");
    assert.equal(restored.scrollY, 4800);
    assert.equal(readFeedSnapshot(latest, "/archive")?.stories.length, 3000);
    const raw = dom.window.sessionStorage.getItem(`hacksnap:feed-snapshot:${first.id}`)!;
    const coldStart = performance.now();
    unpackFeedSnapshot(raw, "/archive");
    if (process.env.MEASURE_FEED_SNAPSHOTS === "1")
      process.stdout.write(
        `session storage cold read 3000=${(performance.now() - coldStart).toFixed(2)}ms\n`,
      );
    assert.equal(unpackFeedSnapshot(raw, "/archive")?.stories.length, 3000);
    const reloaded = new JSDOM("", { url: "https://hacksnap.live/archive" });
    for (const key of keys) {
      if (key) reloaded.window.sessionStorage.setItem(key, dom.window.sessionStorage.getItem(key)!);
    }
    Object.defineProperty(globalThis, "window", { value: reloaded.window, configurable: true });
    const afterReload = readFeedSnapshot(positioned, "/archive")!;
    assert.equal(afterReload.stories.length, 1000);
    assert.equal(afterReload.focusStoryId, "800");
    assert.equal(afterReload.pagination.page, 34);
    reloaded.window.close();
    Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
  } finally {
    if (before) Object.defineProperty(globalThis, "window", before);
    else Reflect.deleteProperty(globalThis, "window");
    dom.window.close();
  }
});

test("denied storage keeps exact same-tab navigation without losing rendered cards", () => {
  const dom = new JSDOM("", { url: "https://hacksnap.live/archive" });
  const before = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
  const previous = Object.getOwnPropertyDescriptor(dom.window.Storage.prototype, "setItem");
  Object.defineProperty(dom.window.Storage.prototype, "setItem", {
    configurable: true,
    value: () => {
      throw Error("quota denied");
    },
  });
  try {
    const deep = snapshot(3000, 100);
    const writeStart = performance.now();
    const ref = saveFeedSnapshot(deep, null)!;
    if (process.env.MEASURE_FEED_SNAPSHOTS === "1")
      process.stdout.write(
        `blocked storage write 3000=${(performance.now() - writeStart).toFixed(2)}ms\n`,
      );
    const readStart = performance.now();
    assert.equal(readFeedSnapshot(ref, "/archive")?.stories.length, 3000);
    if (process.env.MEASURE_FEED_SNAPSHOTS === "1")
      process.stdout.write(
        `blocked storage memory read 3000=${(performance.now() - readStart).toFixed(2)}ms\n`,
      );
    assert.equal(dom.window.sessionStorage.getItem(`hacksnap:feed-snapshot:${ref.id}`), null);
  } finally {
    if (previous) Object.defineProperty(dom.window.Storage.prototype, "setItem", previous);
    if (before) Object.defineProperty(globalThis, "window", before);
    else Reflect.deleteProperty(globalThis, "window");
    dom.window.close();
  }
});

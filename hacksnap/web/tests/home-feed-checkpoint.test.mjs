import assert from "node:assert/strict";
import { afterEach, test } from "@jest/globals";
import {
  HOME_FEED_CHECKPOINT_KEY,
  clearHomeFeedCheckpoint,
  readHomeFeedCheckpoint,
  saveHomeFeedCheckpoint,
} from "../lib/home-feed-checkpoint.ts";

const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const NOW = 1_800_000_000_000;

function story(id) {
  return {
    hn_id: String(id),
    title: `Story ${id}`,
    story_slug: `story-${id}`,
    category: "agents_coding",
    url: "https://example.com/article",
    points: 100,
    comment_count: 20,
    date_added: "2026-09-29T12:00:00.000Z",
    rank: String(id),
    is_recent: true,
    rank_history: [{ observed_at: "2026-09-29T12:00:00.000Z", rank: id }],
    image_url: null,
    image_status: null,
    image_width: null,
    image_height: null,
    image_mime_type: null,
    summary: {
      overall_takeaway: `Takeaway ${id}`,
      sentiment: 0,
      source_coverage: {
        stored_comments: 20,
        included_comments: 10,
        comments_truncated: false,
        article_status: "fetched",
      },
    },
  };
}

function checkpoint(options = {}) {
  const {
    savedAt = NOW,
    expiresAt = new Date(NOW + 60 * 60 * 1000).toISOString(),
    anchor = { storyId: "11", offset: 240 },
    stories = [story(1), story(11)],
  } = options;
  return {
    version: 1,
    snapshot: {
      version: 1,
      url: "/",
      stories,
      pagination: {
        cursor: "next_cursor",
        previousCursor: null,
        hasMore: true,
        page: 2,
        expiresAt,
        selectionLimited: false,
      },
      scrollY: 1200,
      focusStoryId: null,
      savedAt,
    },
    anchor,
  };
}

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

function useStorage(value) {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value });
}

afterEach(() => {
  if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

test("restores root checkpoints as recent or older and retains them for seven days", () => {
  const store = storage({ [HOME_FEED_CHECKPOINT_KEY]: JSON.stringify(checkpoint()) });
  useStorage(store);
  assert.equal(readHomeFeedCheckpoint("/", NOW)?.status, "recent");
  assert.equal(readHomeFeedCheckpoint("/", NOW + 31 * 60 * 1000)?.status, "older");

  store.setItem(
    HOME_FEED_CHECKPOINT_KEY,
    JSON.stringify(checkpoint({ savedAt: NOW - 6 * 24 * 60 * 60 * 1000 })),
  );
  assert.equal(readHomeFeedCheckpoint("/", NOW)?.status, "older");
  store.setItem(
    HOME_FEED_CHECKPOINT_KEY,
    JSON.stringify(checkpoint({ savedAt: NOW - 8 * 24 * 60 * 60 * 1000 })),
  );
  assert.equal(readHomeFeedCheckpoint("/", NOW), null);
});

test("root-only checkpoints report selection expiry without accepting page URLs", () => {
  let reads = 0;
  const store = storage({
    [HOME_FEED_CHECKPOINT_KEY]: JSON.stringify(
      checkpoint({ expiresAt: new Date(NOW - 1).toISOString() }),
    ),
  });
  const getItem = store.getItem;
  store.getItem = (key) => {
    reads++;
    return getItem(key);
  };
  useStorage(store);
  assert.equal(readHomeFeedCheckpoint("/", NOW)?.status, "expired");
  assert.equal(readHomeFeedCheckpoint("/?page=2", NOW), null);
  assert.equal(reads, 1);
});

test("signed viewport anchor offsets are valid when their story remains in the checkpoint", () => {
  const store = storage({
    [HOME_FEED_CHECKPOINT_KEY]: JSON.stringify(
      checkpoint({ anchor: { storyId: "11", offset: -240 } }),
    ),
  });
  useStorage(store);
  assert.equal(readHomeFeedCheckpoint("/", NOW)?.checkpoint.anchor?.offset, -240);
});

test("rejects malformed checkpoints, oversized records, and invalid anchors", () => {
  const store = storage();
  useStorage(store);
  for (const value of [
    "{broken",
    JSON.stringify({ ...checkpoint(), version: 2 }),
    JSON.stringify(checkpoint({ anchor: { storyId: "99", offset: 0 } })),
    JSON.stringify(checkpoint({ anchor: { storyId: "11", offset: -10_000_001 } })),
    JSON.stringify(checkpoint({ savedAt: -1 })),
    JSON.stringify(checkpoint({ savedAt: NOW + 1 })),
    JSON.stringify({ ...checkpoint(), snapshot: { ...checkpoint().snapshot, savedAt: undefined } }),
    JSON.stringify(checkpoint({ stories: Array.from({ length: 401 }, (_, i) => story(i + 1)) })),
    "x".repeat(2 * 1024 * 1024 + 1),
  ]) {
    store.setItem(HOME_FEED_CHECKPOINT_KEY, value);
    assert.equal(readHomeFeedCheckpoint("/", NOW), null);
  }
});

test("save bounds serialized records and clear only removes the checkpoint", () => {
  const store = storage({ unrelated: "keep" });
  useStorage(store);
  const actualNow = Date.now();
  const fresh = checkpoint({
    savedAt: actualNow,
    expiresAt: new Date(actualNow + 60_000).toISOString(),
  });
  assert.equal(saveHomeFeedCheckpoint(fresh), true);
  assert.equal(store.values.get("unrelated"), "keep");
  assert.deepEqual(Object.keys(JSON.parse(store.getItem(HOME_FEED_CHECKPOINT_KEY))), [
    "version",
    "snapshot",
    "anchor",
  ]);
  assert.equal(clearHomeFeedCheckpoint(), true);
  assert.equal(store.values.get(HOME_FEED_CHECKPOINT_KEY), undefined);
  assert.equal(store.values.get("unrelated"), "keep");

  const oversized = checkpoint({
    savedAt: actualNow,
    expiresAt: new Date(actualNow + 60_000).toISOString(),
    stories: [{ ...story(1), title: "x".repeat(2 * 1024 * 1024) }],
    anchor: null,
  });
  assert.equal(saveHomeFeedCheckpoint(oversized), false);
});

test("blocked, unavailable, and quota-limited storage stays nonblocking", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get: () => {
      throw Error("blocked");
    },
  });
  const freshNow = Date.now();
  const fresh = checkpoint({
    savedAt: freshNow,
    expiresAt: new Date(freshNow + 60_000).toISOString(),
  });
  assert.equal(readHomeFeedCheckpoint("/"), null);
  assert.equal(saveHomeFeedCheckpoint(fresh), false);
  assert.equal(clearHomeFeedCheckpoint(), false);

  useStorage({
    getItem: () => {
      throw Error("blocked");
    },
    setItem: () => {
      throw Error("quota");
    },
    removeItem: () => {
      throw Error("blocked");
    },
  });
  assert.equal(readHomeFeedCheckpoint("/"), null);
  assert.equal(saveHomeFeedCheckpoint(fresh), false);
  assert.equal(clearHomeFeedCheckpoint(), false);
});

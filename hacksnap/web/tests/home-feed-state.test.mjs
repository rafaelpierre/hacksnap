import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  appendUniqueStories,
  validFeedPage,
  validFeedSnapshot,
  validFeedSnapshotRef,
  packFeedSnapshot,
  unpackFeedSnapshot,
} from "../lib/feed-state.ts";
import { browsePagination } from "../lib/browse-feed.ts";

const pagination = browsePagination(1, true);

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

test("Latest continuation appends unique cards", () => {
  const first = [story(1), story(2)];
  const result = appendUniqueStories(first, [story(2), story(3)]);
  assert.deepEqual(
    result.map((item) => item.hn_id),
    ["1", "2", "3"],
  );
});

test("return snapshot reconstructs the loaded list before restoring its position", () => {
  const now = Date.now();
  const snapshot = {
    version: 3,
    url: "/",
    stories: [story(1), story(11), story(21)],
    pagination: { ...pagination, page: 3 },
    scrollY: 1930,
    focusStoryId: "21",
    savedAt: now,
  };
  assert.deepEqual(validFeedSnapshot(JSON.parse(JSON.stringify(snapshot)), "/", now), snapshot);
  assert.equal(validFeedSnapshot(snapshot, "/?page=2", now), null);
  assert.equal(validFeedSnapshot({ ...snapshot, savedAt: now - 9 * 3600_000 }, "/", now), null);
  assert.equal(validFeedSnapshot({ ...snapshot, focusStoryId: "99" }, "/", now), null);
});

test("untrusted API and browser records cannot render malformed nested cards", () => {
  const good = story(1);
  assert.ok(validFeedPage({ stories: [good], pagination }));
  for (const malformed of [
    { ...good, summary: "invalid" },
    { ...good, category: {} },
    { ...good, points: Infinity },
    { ...good, rank_history: [null] },
    {
      ...good,
      summary: {
        ...good.summary,
        source_coverage: { ...good.summary.source_coverage, sentiment: null },
      },
    },
  ]) {
    assert.doesNotThrow(() => validFeedPage({ stories: [malformed], pagination }));
    assert.equal(validFeedPage({ stories: [malformed], pagination }), null);
  }
  assert.equal(validFeedPage({ stories: [good, good], pagination }), null);
  assert.equal(
    validFeedPage({ stories: [good], pagination: { ...pagination, cursor: "unsafe!" } }),
    null,
  );
});

test.each(["/", "/2026/09", "/?category=agents-coding"])(
  "%s rejects pending cards and snapshots from the previous browse pagination policy",
  (url) => {
    const now = Date.now();
    const browse = browsePagination(1, true);
    const good = { ...story(1), rank: null };
    const snapshot = {
      version: 3,
      url,
      stories: [good],
      pagination: browse,
      scrollY: 1930,
      focusStoryId: "1",
      savedAt: now,
    };
    const ref = {
      version: 2,
      id: "11111111-1111-4111-8111-111111111111",
      url,
      scrollY: 1930,
      focusStoryId: "1",
      savedAt: now,
      contentAt: now,
      storyCount: 1,
      pagination: browse,
    };
    assert.ok(validFeedSnapshot(snapshot, url, now));
    assert.ok(validFeedSnapshotRef(ref, url, now));
    for (const summary of [
      null,
      { ...good.summary, overall_takeaway: null },
      { ...good.summary, overall_takeaway: "" },
      { ...good.summary, overall_takeaway: " \n\t\r " },
    ]) {
      const pending = { ...good, summary };
      assert.equal(validFeedPage({ stories: [pending], pagination: browse }, url), null);
      assert.equal(validFeedSnapshot({ ...snapshot, stories: [pending] }, url, now), null);
      assert.equal(
        unpackFeedSnapshot(packFeedSnapshot({ ...snapshot, stories: [pending] }), url),
        null,
      );
    }
    for (const pageSize of [undefined, 30]) {
      const previous = { ...browse, pageSize };
      assert.equal(validFeedPage({ stories: [good], pagination: previous }, url), null);
      assert.equal(validFeedSnapshot({ ...snapshot, pagination: previous }, url, now), null);
      assert.equal(validFeedSnapshotRef({ ...ref, pagination: previous }, url, now), null);
      assert.equal(
        unpackFeedSnapshot(packFeedSnapshot({ ...snapshot, pagination: previous }), url),
        null,
      );
    }
  },
);

test("legacy category feed records normalize URLs while retaining loaded depth and strict selection matching", () => {
  const now = Date.now();
  const legacy = {
    version: 3,
    url: "/category/agents-coding?page=2",
    stories: [story(1), story(11), story(21)],
    pagination: browsePagination(4, true),
    scrollY: 1930,
    focusStoryId: "21",
    savedAt: now,
  };
  const canonical = "/?category=agents-coding&page=2";
  const expected = { ...legacy, url: canonical };
  assert.deepEqual(validFeedSnapshot(legacy, canonical, now), expected);
  assert.deepEqual(unpackFeedSnapshot(packFeedSnapshot(legacy), canonical), expected);
  const ref = {
    version: 2,
    id: "12345678-1234-1234-1234-123456789abc",
    url: legacy.url,
    pagination: legacy.pagination,
    scrollY: legacy.scrollY,
    focusStoryId: legacy.focusStoryId,
    savedAt: now,
    contentAt: now,
    storyCount: 3,
  };
  assert.deepEqual(validFeedSnapshotRef(ref, canonical, now), { ...ref, url: canonical });
  for (const wrong of [
    "/?category=agents-coding&page=3",
    "/?category=models-products&page=2",
    "/?page=2",
  ]) {
    assert.equal(validFeedSnapshot(legacy, wrong, now), null);
    assert.equal(validFeedSnapshotRef(ref, wrong, now), null);
  }
  assert.equal(validFeedSnapshot({ ...legacy, savedAt: now - 9 * 3600000 }, canonical, now), null);
});

import assert from "node:assert/strict";
import { test } from "@jest/globals";
import {
  appendUniqueStories,
  homePageURL,
  validHomeFeedPage,
  validHomeFeedSnapshot,
} from "../lib/home-feed-state.ts";

const pagination = {
  cursor: "next_cursor",
  previousCursor: null,
  hasMore: true,
  page: 1,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  selectionLimited: false,
};

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

test("home continuation appends unique cards and builds ordinary frozen page links", () => {
  const first = [story(1), story(2)];
  const result = appendUniqueStories(first, [story(2), story(3)]);
  assert.deepEqual(
    result.map((item) => item.hn_id),
    ["1", "2", "3"],
  );
  assert.equal(homePageURL(1, null), "/");
  assert.equal(homePageURL(1, "frozen"), "/?page=1&cursor=frozen");
  assert.equal(homePageURL(3, "frozen"), "/?page=3&cursor=frozen");
});

test("return snapshot reconstructs the loaded list before restoring its position", () => {
  const now = Date.now();
  const snapshot = {
    version: 1,
    url: "/",
    stories: [story(1), story(11), story(21)],
    pagination: { ...pagination, page: 3 },
    scrollY: 1930,
    focusStoryId: "21",
    savedAt: now,
  };
  assert.deepEqual(validHomeFeedSnapshot(JSON.parse(JSON.stringify(snapshot)), "/", now), snapshot);
  assert.equal(validHomeFeedSnapshot(snapshot, "/?page=2", now), null);
  assert.equal(validHomeFeedSnapshot({ ...snapshot, savedAt: now - 9 * 3600_000 }, "/", now), null);
  assert.equal(validHomeFeedSnapshot({ ...snapshot, focusStoryId: "99" }, "/", now), null);
});

test("untrusted API and browser records cannot render malformed nested cards", () => {
  const good = story(1);
  assert.ok(validHomeFeedPage({ stories: [good], pagination }));
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
    assert.doesNotThrow(() => validHomeFeedPage({ stories: [malformed], pagination }));
    assert.equal(validHomeFeedPage({ stories: [malformed], pagination }), null);
  }
  assert.equal(validHomeFeedPage({ stories: [good, good], pagination }), null);
  assert.equal(
    validHomeFeedPage({ stories: [good], pagination: { ...pagination, cursor: "unsafe!" } }),
    null,
  );
});

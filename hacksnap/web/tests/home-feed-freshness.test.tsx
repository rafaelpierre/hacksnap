import assert from "node:assert/strict";
import { test } from "@jest/globals";
import React, { act } from "react";
import { createRequire } from "node:module";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { StoryFeed } from "../app/story-feed";
import { browsePagination } from "../lib/browse-feed";
import { readFeedSnapshot } from "../lib/feed-snapshot-storage";
import { HOME_FEED_CHECKPOINT_KEY } from "../lib/home-feed-checkpoint";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
function story(id: number) {
  return {
    hn_id: String(id),
    story_slug: null,
    title: `Story ${id}`,
    category: null,
    url: "https://example.com/article",
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
    summary: { overall_takeaway: `Published ${id}`, sentiment: null, source_coverage: null },
  };
}

test("root Latest ignores retired ranked state, loads 15 via browse API, and restores depth on reload", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/" });
  const initial = Array.from({ length: 15 }, (_, index) => story(index + 100));
  const old = {
    version: 1,
    url: "/",
    stories: [story(1)],
    pagination: {
      page: 1,
      hasMore: true,
      cursor: "old_ranked_cursor",
      previousCursor: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      selectionLimited: false,
    },
    scrollY: 1000,
    focusStoryId: null,
    savedAt: Date.now(),
  };
  dom.window.history.replaceState({ hacksnapHomeFeed: old }, "", "/");
  dom.window.localStorage.setItem(
    HOME_FEED_CHECKPOINT_KEY,
    JSON.stringify({ version: 1, snapshot: old, anchor: null }),
  );
  dom.window.localStorage.setItem("unrelated", "keep");
  dom.window.scrollTo = (() => {}) as typeof dom.window.scrollTo;
  const values = {
    self: dom.window,
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    IntersectionObserver: undefined,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
    cancelAnimationFrame: () => {},
  };
  const previous = Object.keys(values).map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  Object.entries(values).forEach(([key, value]) =>
    Object.defineProperty(globalThis, key, { value, configurable: true }),
  );
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (url) => {
    requests.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        stories: Array.from({ length: 15 }, (_, index) => story(index + 115)),
        pagination: browsePagination(2, false),
      }),
    } as Response;
  }) as typeof fetch;
  const { createRoot } = await import("react-dom/client");
  let root = createRoot(document.getElementById("root")!);
  const render = () =>
    act(async () =>
      root.render(
        <AppRouterContext.Provider value={{ push: () => {}, prefetch: async () => {} } as never}>
          <StoryFeed initialStories={initial} initialPagination={browsePagination(1, true)} />
        </AppRouterContext.Provider>,
      ),
    );
  try {
    await render();
    assert.equal(document.querySelectorAll(".story-list > li").length, 15);
    assert.equal(document.querySelector(".feed-story-title")?.textContent, "Story 100");
    assert.equal(document.querySelector(".feed-freshness-banner"), null);
    assert.equal(dom.window.localStorage.getItem(HOME_FEED_CHECKPOINT_KEY), null);
    assert.equal(dom.window.localStorage.getItem("unrelated"), "keep");
    assert.deepEqual(requests, [], "Latest makes no ranked freshness request");
    await act(async () =>
      (document.querySelector(".home-feed-actions button") as HTMLButtonElement).click(),
    );
    assert.deepEqual(requests, ["/api/browse-stories?path=%2F&page=2"]);
    assert.equal(document.querySelectorAll(".story-list > li").length, 30);
    const ref = dom.window.history.state.hacksnapHomeFeed;
    assert.equal(ref.pagination.pageSize, 15);
    assert.equal(ref.pagination.cursor, null);
    assert.equal(readFeedSnapshot(ref, "/")?.stories.length, 30);
    await act(async () => root.unmount());
    Object.defineProperty(dom.window.performance, "getEntriesByType", {
      configurable: true,
      value: () => [{ type: "reload", name: "https://hacksnap.live/" }],
    });
    root = createRoot(document.getElementById("root")!);
    await render();
    assert.equal(document.querySelectorAll(".story-list > li").length, 30);
    assert.equal(
      readFeedSnapshot(dom.window.history.state.hacksnapHomeFeed, "/")?.stories.length,
      30,
    );
    assert.equal(requests.length, 1);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
    Object.keys(values).forEach((key, index) => {
      if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});

import assert from "node:assert/strict";
import { test } from "@jest/globals";
import React, { act } from "react";
import { createRequire } from "node:module";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import {
  clearStoryHistory,
  markStoryOpened,
  readStoryHistory,
  STORY_HISTORY_KEY,
} from "../lib/story-history";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

function globals(dom: InstanceType<typeof JSDOM>, extra: Record<string, unknown> = {}) {
  const values = {
    self: dom.window,
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    ...extra,
  };
  const previous = Object.keys(values).map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  Object.entries(values).forEach(([key, value]) =>
    Object.defineProperty(globalThis, key, { value, configurable: true }),
  );
  return () =>
    Object.keys(values).forEach((key, index) => {
      if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!);
      else Reflect.deleteProperty(globalThis, key);
    });
}

function story(id: number) {
  return {
    hn_id: String(id),
    title: `Story ${id}`,
    story_slug: `story-${id}`,
    category: "agents_coding" as const,
    url: "https://example.com/article",
    points: 42,
    comment_count: 10,
    date_added: "2026-09-29T12:00:00.000Z",
    rank: String(id),
    is_recent: true,
    rank_history: [],
    image_url: null,
    image_status: null,
    image_width: null,
    image_height: null,
    image_mime_type: null,
    summary: null,
  };
}

test("legacy exposure is discarded and an unmounted tab preserves another tab's opening", () => {
  const dom = new JSDOM("", { url: "https://hacksnap.live/" });
  const restore = globals(dom);
  try {
    clearStoryHistory();
    dom.window.localStorage.setItem(
      STORY_HISTORY_KEY,
      JSON.stringify({
        version: 1,
        hideSeen: true,
        entries: {
          "404": { seenAt: Date.now() },
          "101": { seenAt: Date.now(), openedAt: Date.now() },
        },
      }),
    );
    assert.equal(readStoryHistory().version, 3);
    assert.equal(readStoryHistory().entries["404"], undefined);
    assert.equal(!!readStoryHistory().entries["101"]?.openedAt, true);
    assert.equal("seenAt" in readStoryHistory().entries["101"], false);
    markStoryOpened("303");
    // No storage event or mounted feed subscription arrives during this interval.
    dom.window.localStorage.setItem(
      STORY_HISTORY_KEY,
      JSON.stringify({
        version: 3,
        entries: {
          "101": readStoryHistory().entries["101"],
          "202": { openedAt: Date.now() },
        },
      }),
    );
    markStoryOpened("505");
    assert.deepEqual(Object.keys(readStoryHistory().entries).sort(), ["101", "202", "505"]);
    const saved = JSON.parse(dom.window.localStorage.getItem(STORY_HISTORY_KEY)!);
    assert.equal(saved.version, 3);
    assert.deepEqual(Object.keys(saved.entries).sort(), ["101", "202", "505"]);
    clearStoryHistory();
    assert.deepEqual(readStoryHistory().entries, {});
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw Error("blocked");
      },
    });
    markStoryOpened("606");
    assert.equal(!!readStoryHistory().entries["606"]?.openedAt, true);
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: dom.window.localStorage,
    });
    clearStoryHistory();
    restore();
    dom.window.close();
  }
});

test("only a successful opening changes a feed title; exposure has no visual marker", async () => {
  const { StoryFeed } = await import("../app/story-feed");
  const { browsePagination } = await import("../lib/browse-feed");
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/archive" });
  const restore = globals(dom, { IntersectionObserver: undefined });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  try {
    clearStoryHistory();
    dom.window.localStorage.setItem(
      STORY_HISTORY_KEY,
      JSON.stringify({
        version: 2,
        entries: {
          "101": { seenAt: Date.now() },
          "102": { seenAt: Date.now(), openedAt: Date.now() },
        },
      }),
    );
    await act(async () =>
      root.render(
        <AppRouterContext.Provider value={{ push: () => {}, prefetch: async () => {} } as never}>
          <StoryFeed
            initialStories={[story(101), story(102)]}
            initialPagination={browsePagination(1, false)}
            listingPath="/archive"
          />
        </AppRouterContext.Provider>,
      ),
    );
    assert.equal(document.querySelector('[data-home-story-id="101"] h3')?.className, "");
    assert.equal(
      document.querySelector('[data-home-story-id="102"] h3')?.className,
      "story-title-opened",
    );
    assert.doesNotMatch(document.body.textContent!, /Seen|Opened|Hide seen|Clear viewing history/);
    assert.equal(readStoryHistory().entries["101"], undefined);
  } finally {
    await act(async () => root.unmount());
    clearStoryHistory();
    restore();
    dom.window.close();
  }
});

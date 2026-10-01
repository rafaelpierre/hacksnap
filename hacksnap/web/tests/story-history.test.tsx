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
  STORY_OPENED_KEY_PREFIX,
  MAX_HISTORY_STORIES,
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

test("legacy openings migrate to independent keys and seen-only records disappear", () => {
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
    assert.equal(readStoryHistory().version, 4);
    assert.equal(readStoryHistory().entries["404"], undefined);
    assert.equal(!!readStoryHistory().entries["101"]?.openedAt, true);
    assert.equal("seenAt" in readStoryHistory().entries["101"], false);
    assert.equal(dom.window.localStorage.getItem(STORY_HISTORY_KEY), null);
    assert.match(dom.window.localStorage.getItem(STORY_OPENED_KEY_PREFIX + "101")!, /^1:/);
    assert.equal(dom.window.localStorage.getItem(STORY_OPENED_KEY_PREFIX + "404"), null);
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

test("interleaved tabs opening different stories preserve both independent records", () => {
  const dom = new JSDOM("", { url: "https://hacksnap.live/" });
  const restore = globals(dom);
  const real = dom.window.localStorage;
  let interleaved = false;
  try {
    clearStoryHistory();
    real.setItem("hacksnap:other-feature", "keep");
    // Writer B completes while writer A is inside its storage write. A shared
    // read/modify/write map loses B's ID in this exact order.
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        get length() {
          return real.length;
        },
        key: (index: number) => real.key(index),
        getItem: (key: string) => real.getItem(key),
        removeItem: (key: string) => real.removeItem(key),
        setItem: (key: string, value: string) => {
          if (key === STORY_OPENED_KEY_PREFIX + "101" && !interleaved) {
            interleaved = true;
            // A separate tab writes its own key without sharing this module's memory.
            real.setItem(STORY_OPENED_KEY_PREFIX + "202", `1:${Date.now()}`);
          }
          real.setItem(key, value);
        },
      },
    });
    markStoryOpened("101");
    assert.equal(interleaved, true);
    assert.deepEqual(Object.keys(readStoryHistory().entries).sort(), ["101", "202"]);
    assert.match(real.getItem(STORY_OPENED_KEY_PREFIX + "101")!, /^1:/);
    assert.match(real.getItem(STORY_OPENED_KEY_PREFIX + "202")!, /^1:/);
    assert.equal(real.getItem("hacksnap:other-feature"), "keep");
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: real });
    clearStoryHistory();
    restore();
    dom.window.close();
  }
});

test("retention prunes old and malformed records without touching other feature keys", () => {
  const dom = new JSDOM("", { url: "https://hacksnap.live/" });
  const restore = globals(dom);
  const store = dom.window.localStorage;
  try {
    clearStoryHistory();
    store.setItem("hacksnap:other-feature", "keep");
    store.setItem(STORY_OPENED_KEY_PREFIX + "111", `1:${Date.now() - 181 * 86400_000}`);
    store.setItem(STORY_OPENED_KEY_PREFIX + "222", "2:not-a-timestamp");
    store.setItem(STORY_OPENED_KEY_PREFIX + "oops", `1:${Date.now()}`);
    for (let id = 10000; id < 10000 + MAX_HISTORY_STORIES + 5; id++)
      store.setItem(STORY_OPENED_KEY_PREFIX + id, `1:${Date.now()}`);
    const history = readStoryHistory();
    assert.equal(history.entries["111"], undefined);
    assert.equal(history.entries["222"], undefined);
    assert.equal(history.entries.oops, undefined);
    assert.ok(Object.keys(history.entries).length <= MAX_HISTORY_STORIES);
    let bytes = 0;
    for (let index = 0; index < store.length; index++) {
      const key = store.key(index)!;
      if (key.startsWith(STORY_OPENED_KEY_PREFIX))
        bytes += (key.length + store.getItem(key)!.length) * 2;
    }
    assert.ok(bytes <= 320 * 1024);
    assert.equal(store.getItem("hacksnap:other-feature"), "keep");
  } finally {
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
    assert.equal(!!readStoryHistory().entries["102"]?.openedAt, true);
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

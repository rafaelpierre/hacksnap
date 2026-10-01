import assert from "node:assert/strict";
import { test, jest } from "@jest/globals";
import React, { act } from "react";
import { createRequire } from "node:module";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import {
  clearStoryHistory,
  markStoryOpened,
  markStorySeen,
  readStoryHistory,
  STORY_HISTORY_KEY,
} from "../lib/story-history";
import { WindowedStoryList } from "../app/windowed-story-list";

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

test("legacy Hide seen data migrates without filtering intent; timestamps stay independent and clearable", () => {
  const dom = new JSDOM("", { url: "https://hacksnap.live/" });
  const restore = globals(dom);
  try {
    dom.window.localStorage.setItem(
      STORY_HISTORY_KEY,
      JSON.stringify({
        version: 1,
        hideSeen: true,
        entries: { "404": { seenAt: Date.now() } },
      }),
    );
    assert.equal(readStoryHistory().version, 2);
    assert.equal(!!readStoryHistory().entries["404"]?.seenAt, true);
    assert.equal("hideSeen" in readStoryHistory(), false);
    clearStoryHistory();
    markStorySeen("101", 1_000_000_000_000);
    markStoryOpened("202");
    assert.equal(readStoryHistory().entries["101"]?.seenAt, undefined, "old exposures expire");
    markStorySeen("101");
    assert.equal(!!readStoryHistory().entries["101"]?.seenAt, true);
    assert.equal(readStoryHistory().entries["101"]?.openedAt, undefined);
    assert.equal(!!readStoryHistory().entries["202"]?.openedAt, true);
    assert.equal(readStoryHistory().entries["202"]?.seenAt, undefined);
    assert.equal(JSON.parse(dom.window.localStorage.getItem(STORY_HISTORY_KEY)!).version, 2);
    clearStoryHistory();
    assert.deepEqual(readStoryHistory().entries, {});
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw Error("blocked");
      },
    });
    markStoryOpened("303");
    assert.equal(!!readStoryHistory().entries["303"]?.openedAt, true);
  } finally {
    clearStoryHistory();
    restore();
    dom.window.close();
  }
});

test("a card needs 50% continuous exposure for 1.5 seconds in the foreground", async () => {
  jest.useFakeTimers();
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/" });
  let visibility = "visible";
  Object.defineProperty(dom.window.document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  const observed: Array<{ callback: IntersectionObserverCallback; element: Element }> = [];
  const restore = globals(dom, {
    IntersectionObserver: class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(element: Element) {
        observed.push({ callback: this.callback, element });
      }
      disconnect() {}
    },
  });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const marked: string[] = [];
  const entry = (ratio: number) =>
    ({ isIntersecting: ratio > 0, intersectionRatio: ratio }) as IntersectionObserverEntry;
  try {
    await act(async () =>
      root.render(
        <AppRouterContext.Provider value={{ push: () => {}, prefetch: async () => {} } as never}>
          <WindowedStoryList
            stories={[story(111)]}
            ranked
            initialPage={1}
            groupByDay={false}
            onSeen={(id) => marked.push(id)}
          />
        </AppRouterContext.Provider>,
      ),
    );
    const observer = observed.find(
      ({ element }) => element.getAttribute("data-home-story-id") === "111",
    )!;
    await act(async () => observer.callback([entry(0.49)], {} as IntersectionObserver));
    await act(async () => jest.advanceTimersByTime(2000));
    assert.deepEqual(marked, []);
    await act(async () => observer.callback([entry(0.5)], {} as IntersectionObserver));
    await act(async () => jest.advanceTimersByTime(1000));
    await act(async () => observer.callback([entry(0)], {} as IntersectionObserver));
    await act(async () => jest.advanceTimersByTime(1000));
    assert.deepEqual(marked, [], "a rapid pass is not seen");
    await act(async () => observer.callback([entry(0.5)], {} as IntersectionObserver));
    visibility = "hidden";
    await act(async () => document.dispatchEvent(new dom.window.Event("visibilitychange")));
    await act(async () => jest.advanceTimersByTime(2000));
    assert.deepEqual(marked, [], "background time does not count");
    visibility = "visible";
    await act(async () => document.dispatchEvent(new dom.window.Event("visibilitychange")));
    await act(async () => jest.advanceTimersByTime(1500));
    assert.deepEqual(marked, ["111"]);
  } finally {
    await act(async () => root.unmount());
    restore();
    dom.window.close();
    jest.useRealTimers();
  }
});

test("previously seen cards remain in the feed with quiet Seen and Opened labels", async () => {
  const { StoryFeed } = await import("../app/story-feed");
  const { browsePagination } = await import("../lib/browse-feed");
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/archive" });
  const restore = globals(dom, { IntersectionObserver: undefined });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  try {
    clearStoryHistory();
    markStorySeen("101");
    markStoryOpened("102");
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
    assert.ok(document.querySelector('[data-home-story-id="101"]'));
    assert.ok(document.querySelector('[data-home-story-id="102"]'));
    assert.equal(document.querySelector(".story-history-controls"), null);
    assert.match(document.querySelector('[data-home-story-id="101"]')!.textContent!, /Seen/);
    assert.match(document.querySelector('[data-home-story-id="102"]')!.textContent!, /Opened/);
    assert.doesNotMatch(document.body.textContent!, /Hide seen|Clear viewing history/);
  } finally {
    await act(async () => root.unmount());
    clearStoryHistory();
    restore();
    dom.window.close();
  }
});

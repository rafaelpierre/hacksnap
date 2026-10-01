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
  setHideSeen,
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

test("seen, opened and preference persist independently; clear and blocked storage keep browsing usable", () => {
  const dom = new JSDOM("", { url: "https://hacksnap.live/" });
  const restore = globals(dom);
  try {
    clearStoryHistory();
    setHideSeen(false);
    markStorySeen("101", 1_000_000_000_000);
    markStoryOpened("202");
    assert.equal(readStoryHistory().entries["101"]?.seenAt, undefined, "old exposures expire");
    markStorySeen("101");
    assert.equal(!!readStoryHistory().entries["101"]?.seenAt, true);
    assert.equal(readStoryHistory().entries["101"]?.openedAt, undefined);
    assert.equal(!!readStoryHistory().entries["202"]?.openedAt, true);
    assert.equal(readStoryHistory().entries["202"]?.seenAt, undefined);
    setHideSeen(true);
    assert.equal(JSON.parse(dom.window.localStorage.getItem(STORY_HISTORY_KEY)!).version, 1);
    assert.equal(readStoryHistory().hideSeen, true);
    clearStoryHistory();
    assert.deepEqual(readStoryHistory().entries, {});
    assert.equal(readStoryHistory().hideSeen, true);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw Error("blocked");
      },
    });
    markStoryOpened("303");
    assert.equal(!!readStoryHistory().entries["303"]?.openedAt, true);
  } finally {
    setHideSeen(false);
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

test("Hide seen skips three all-seen pages, pauses auto loading, then continues on request", async () => {
  const { StoryFeed } = await import("../app/story-feed");
  const { browsePagination } = await import("../lib/browse-feed");
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/archive" });
  let sentinel: IntersectionObserverCallback | null = null;
  const restore = globals(dom, {
    IntersectionObserver: class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(element: Element) {
        if (element.classList.contains("home-feed-sentinel")) sentinel = this.callback;
      }
      disconnect() {
        if (sentinel === this.callback) sentinel = null;
      }
    },
  });
  const originalFetch = globalThis.fetch;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        stories: [story(101 + requests)],
        pagination: browsePagination(1 + requests, true),
      }),
    } as Response;
  }) as typeof fetch;
  try {
    clearStoryHistory();
    for (const id of [101, 102, 103, 104]) markStorySeen(String(id));
    setHideSeen(true);
    await act(async () =>
      root.render(
        <AppRouterContext.Provider value={{ push: () => {}, prefetch: async () => {} } as never}>
          <StoryFeed
            initialStories={[story(101)]}
            initialPagination={browsePagination(1, true)}
            listingPath="/archive"
          />
        </AppRouterContext.Provider>,
      ),
    );
    assert.equal(document.querySelector('[data-home-story-id="101"]'), null);
    assert.match(document.body.textContent!, /All loaded stories are seen/);
    for (let page = 0; page < 3; page++) {
      assert.ok(sentinel);
      const fire = sentinel;
      await act(async () =>
        (fire as IntersectionObserverCallback)(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        ),
      );
    }
    assert.equal(requests, 3);
    assert.match(document.body.textContent!, /Find more unseen stories/);
    await act(async () =>
      (document.querySelector(".home-feed-actions button") as HTMLButtonElement).click(),
    );
    assert.equal(requests, 4);
    assert.ok(document.querySelector('[data-home-story-id="105"]'));
    await act(async () => markStorySeen("105"));
    assert.ok(document.querySelector('[data-home-story-id="105"]'), "newly seen row stays mounted");
    assert.match(document.querySelector('[data-home-story-id="105"]')!.textContent!, /Seen/);
    await act(async () =>
      (document.querySelector(".story-history-controls input") as HTMLInputElement).click(),
    );
    assert.ok(document.querySelector('[data-home-story-id="101"]'));
    Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
      configurable: true,
      value: function (this: HTMLElement) {
        const shown = this.dataset.homeStoryId === "105";
        return {
          top: shown ? 0 : 1000,
          bottom: shown ? 100 : 1100,
          left: 0,
          right: 200,
          width: 200,
          height: 100,
        };
      },
    });
    await act(async () =>
      (document.querySelector(".story-history-controls input") as HTMLInputElement).click(),
    );
    assert.ok(document.querySelector('[data-home-story-id="105"]'), "visible card survives toggle");
    assert.equal(document.querySelector('[data-home-story-id="101"]'), null);
    await act(async () =>
      (document.querySelector(".story-history-controls button") as HTMLButtonElement).click(),
    );
    assert.equal(document.activeElement, document.querySelector(".story-history-controls input"));
    assert.match(
      document.querySelector('.story-history-controls [role="status"]')!.textContent!,
      /Viewing history cleared/,
    );
    assert.ok(document.querySelector('[data-home-story-id="101"]'));
  } finally {
    await act(async () => root.unmount());
    setHideSeen(false);
    clearStoryHistory();
    globalThis.fetch = originalFetch;
    restore();
    dom.window.close();
  }
});

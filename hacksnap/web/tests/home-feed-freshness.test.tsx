import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "@jest/globals";
import React, { act } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { StoryFeed } from "../app/story-feed";
import { HOME_FEED_CHECKPOINT_KEY } from "../lib/home-feed-checkpoint";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

function story(id: number) {
  return {
    hn_id: String(id),
    story_slug: `story-${id}`,
    title: `Story ${id}`,
    category: "agents_coding" as const,
    url: "https://example.com/article",
    points: 100,
    comment_count: 20,
    date_added: "2026-09-29T12:00:00.000Z",
    rank: String(id),
    is_recent: true,
    rank_history: [],
    image_url: null,
    image_status: null,
    image_width: null,
    image_height: null,
    image_mime_type: null,
    summary: {
      overall_takeaway: `Takeaway ${id}`,
      sentiment: 0 as const,
      source_coverage: {
        stored_comments: 20,
        included_comments: 10,
        comments_truncated: false,
        article_status: "fetched" as const,
      },
    },
  };
}

function pagination(expiresAt = new Date(Date.now() + 60_000).toISOString(), hasMore = false) {
  return {
    cursor: hasMore ? "old_cursor" : null,
    previousCursor: null,
    hasMore,
    page: 1,
    expiresAt,
    selectionLimited: false,
  };
}

test("polling keeps rows and scroll stable until explicit refresh focuses the first story", async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://hacksnap.live/",
    pretendToBeVisual: true,
  });
  let onIntersection: IntersectionObserverCallback = () => {
    throw new Error("Feed intersection observer was not attached");
  };
  let observerAttached = false;
  const globals = {
    self: dom.window,
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
    cancelAnimationFrame: () => {},
    IntersectionObserver: class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe() {
        observerAttached = true;
        onIntersection = this.callback;
      }
      disconnect() {
        if (onIntersection === this.callback) observerAttached = false;
      }
    },
  };
  const previous = Object.keys(globals).map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  Object.entries(globals).forEach(([key, value]) =>
    Object.defineProperty(globalThis, key, { value, configurable: true }),
  );
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  const scrolls: number[] = [];
  dom.window.scrollTo = ((options: ScrollToOptions) => {
    scrolls.push(options.top ?? 0);
  }) as typeof dom.window.scrollTo;
  const checks = [
    ["1", "2", "3"],
    ["3", "1", "2"],
    ["1", "2", "3", "4"],
    ["4", "1", "2", "3"],
  ];
  let oldCalls = 0;
  let resolveOld: (response: Response) => void = () => {
    throw new Error("Old page request was not started");
  };
  let resolveFresh: (response: Response) => void = () => {
    throw new Error("Fresh page request was not started");
  };
  let freshRequested = false;
  globalThis.fetch = (async (url) => {
    if (String(url) === "/api/story-freshness")
      return { ok: true, json: async () => ({ ids: checks.shift() ?? [] }) } as Response;
    if (String(url) === "/api/ready-stories?cursor=old_cursor") {
      oldCalls++;
      return new Promise<Response>((resolve) => {
        resolveOld = resolve;
      });
    }
    assert.equal(String(url), "/api/ready-stories?fresh=1");
    return new Promise<Response>((resolve) => {
      freshRequested = true;
      resolveFresh = resolve;
    });
  }) as typeof fetch;
  const freshResponse = () =>
    ({
      ok: true,
      json: async () => ({
        stories: [story(4), story(1), story(2)],
        pagination: pagination(),
        selectionIds: ["4", "1", "2", "3"],
      }),
    }) as Response;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const router = { push: () => {}, prefetch: async () => {} };
  const ids = () =>
    [...document.querySelectorAll(".story-list [data-home-story-id]")].map((node) =>
      node.getAttribute("data-home-story-id"),
    );
  try {
    await act(async () =>
      root.render(
        <AppRouterContext.Provider value={router as never}>
          <StoryFeed
            initialStories={[story(1), story(2)]}
            initialPagination={pagination(new Date(now - 1000).toISOString(), true)}
            initialSelectionIds={["1", "2", "3"]}
          />
        </AppRouterContext.Provider>,
      ),
    );
    assert.equal(document.querySelector(".feed-freshness-banner"), null);
    assert.deepEqual(ids(), ["1", "2"]);
    now += 60_001;
    await act(async () => document.dispatchEvent(new dom.window.Event("visibilitychange")));
    assert.equal(
      document.querySelector(".feed-freshness-banner"),
      null,
      "rank changes within the frozen selection do not announce new stories",
    );
    now += 60_001;
    await act(async () => document.dispatchEvent(new dom.window.Event("visibilitychange")));
    assert.match(
      document.querySelector(".feed-freshness-banner")!.textContent!,
      /New stories available/,
    );
    assert.deepEqual(ids(), ["1", "2"]);
    assert.deepEqual(scrolls, []);
    assert.ok(observerAttached);
    const staleIntersection = onIntersection;
    await act(async () =>
      staleIntersection(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    assert.equal(oldCalls, 1);
    await act(async () =>
      document.querySelector<HTMLButtonElement>(".feed-freshness-banner button")!.click(),
    );
    assert.ok(freshRequested);
    await act(async () =>
      staleIntersection(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
    assert.equal(oldCalls, 1, "an old cursor must not restart during refresh");
    await act(async () => resolveFresh(freshResponse()));
    await act(async () => resolveOld({ ok: true, json: async () => ({}) } as Response));
    assert.equal(document.querySelector(".feed-freshness-banner"), null);
    assert.deepEqual(ids(), ["4", "1", "2"]);
    assert.deepEqual(scrolls, [0]);
    assert.equal(document.activeElement?.textContent, "Story 4");
    now += 60_001;
    await act(async () => document.dispatchEvent(new dom.window.Event("visibilitychange")));
    assert.equal(document.querySelector(".feed-freshness-banner"), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    Object.keys(globals).forEach((key, index) => {
      const descriptor = previous[index];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});

test("refreshing a continuation page resets positions and removes its old newer link", async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "https://hacksnap.live/?page=2&cursor=later_cursor",
    pretendToBeVisual: true,
  });
  dom.window.scrollTo = (() => {}) as typeof dom.window.scrollTo;
  const globals = {
    self: dom.window,
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    },
    cancelAnimationFrame: () => {},
  };
  const previous = Object.keys(globals).map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  Object.entries(globals).forEach(([key, value]) =>
    Object.defineProperty(globalThis, key, { value, configurable: true }),
  );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url) => {
    if (String(url) === "/api/story-freshness")
      return { ok: true, json: async () => ({ ids: ["11", "12", "99"] }) } as Response;
    assert.equal(String(url), "/api/ready-stories?fresh=1");
    return {
      ok: true,
      json: async () => ({
        stories: [story(99), story(1)],
        pagination: pagination(),
        selectionIds: ["99", "1"],
      }),
    } as Response;
  }) as typeof fetch;
  const { createRoot } = await import("react-dom/client");
  let root = createRoot(document.getElementById("root")!);
  const router = { push: () => {}, prefetch: async () => {} };
  const homeOpenPositions = () =>
    ((dom.window as Window & { dataLayer?: Array<ArrayLike<unknown>> }).dataLayer ?? [])
      .filter((entry) => entry[1] === "home_story_open")
      .map((entry) => (entry[2] as { position: number }).position);
  try {
    await act(async () =>
      root.render(
        <AppRouterContext.Provider value={router as never}>
          <StoryFeed
            initialStories={[story(11), story(12)]}
            initialPagination={{
              ...pagination(undefined, true),
              page: 2,
              previousCursor: "earlier_cursor",
            }}
            initialSelectionIds={["11", "12"]}
          />
        </AppRouterContext.Provider>,
      ),
    );
    assert.equal(document.querySelector(".story-list")?.getAttribute("start"), "11");
    assert.equal(
      document.querySelector<HTMLAnchorElement>(".home-feed-pages a")?.getAttribute("href"),
      "/?page=1&cursor=earlier_cursor",
    );
    assert.equal(document.querySelector(".home-feed-pages")?.textContent, "Newer stories");
    await act(async () =>
      document
        .querySelector<HTMLAnchorElement>(".story-list h3 a")!
        .dispatchEvent(new dom.window.MouseEvent("auxclick", { bubbles: true, button: 1 })),
    );
    assert.deepEqual(homeOpenPositions(), [11]);
    assert.ok(document.querySelector(".feed-freshness-banner button"));

    await act(async () =>
      document.querySelector<HTMLButtonElement>(".feed-freshness-banner button")!.click(),
    );
    assert.equal(dom.window.location.pathname + dom.window.location.search, "/");
    assert.equal(document.querySelector(".story-list")?.getAttribute("start"), null);
    assert.equal(document.querySelector(".home-feed-pages"), null);
    assert.equal(
      document
        .querySelector(".story-list [data-home-story-id]")
        ?.getAttribute("data-home-story-id"),
      "99",
    );
    assert.equal(document.activeElement?.textContent, "Story 99");
    await act(async () =>
      document
        .querySelector<HTMLAnchorElement>(".story-list h3 a")!
        .dispatchEvent(new dom.window.MouseEvent("auxclick", { bubbles: true, button: 1 })),
    );
    assert.deepEqual(homeOpenPositions(), [11], "refreshed first story has position one");
    const saved = JSON.parse(dom.window.localStorage.getItem(HOME_FEED_CHECKPOINT_KEY)!);
    assert.equal(saved.snapshot.url, "/");
    assert.equal(saved.snapshot.pagination.page, 1);
    assert.equal(saved.snapshot.stories[0].hn_id, "99");

    await act(async () => root.unmount());
    root = createRoot(document.getElementById("root")!);
    await act(async () =>
      root.render(
        <AppRouterContext.Provider value={router as never}>
          <StoryFeed
            initialStories={[story(11), story(12)]}
            initialPagination={{
              ...pagination(undefined, true),
              page: 2,
              previousCursor: "earlier_cursor",
            }}
            initialSelectionIds={["11", "12", "99"]}
          />
        </AppRouterContext.Provider>,
      ),
    );
    assert.equal(
      document
        .querySelector(".story-list [data-home-story-id]")
        ?.getAttribute("data-home-story-id"),
      "99",
    );
    assert.equal(document.querySelector(".story-list")?.getAttribute("start"), null);
    assert.equal(document.querySelector(".home-feed-pages"), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    globalThis.fetch = originalFetch;
    Object.keys(globals).forEach((key, index) => {
      const descriptor = previous[index];
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});

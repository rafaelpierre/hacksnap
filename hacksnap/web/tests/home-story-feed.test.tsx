import assert from "node:assert/strict";
import { test } from "@jest/globals";
import React, { act } from "react";
import { createRequire } from "node:module";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { HomeStoryFeed } from "../app/home-story-feed";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

function story(id: number) {
  return {
    hn_id: String(id),
    title: `Story ${id}`,
    story_slug: `story-${id}`,
    category: "agents_coding" as const,
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

function pagination(page: number, hasMore: boolean) {
  return {
    cursor: hasMore ? `cursor_${page + 1}` : null,
    previousCursor: page > 1 ? `cursor_${page - 1}` : null,
    hasMore,
    page,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    selectionLimited: false,
  };
}

for (const settlement of ["resolve", "reject"] as const) {
  test(`continuation cancellation tracks once when fetch ${settlement}s and preserves manual loading and history`, async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/" });
    let onIntersection: IntersectionObserverCallback | null = null;
    let observations = 0;
    const values = {
      IntersectionObserver: class {
        constructor(callback: IntersectionObserverCallback) {
          onIntersection = callback;
        }
        observe() {
          observations++;
        }
        disconnect() {
          onIntersection = null;
        }
      },
      self: dom.window,
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      IS_REACT_ACT_ENVIRONMENT: true,
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
    const { createRoot } = await import("react-dom/client");
    const router = { push: () => {}, prefetch: async () => {} };
    const first = Array.from({ length: 10 }, (_, index) => story(index + 1));
    const second = [story(11), story(12)];
    const loadEvents: { outcome: string; trigger: string; position: number }[] = [];
    dom.window.gtag = (
      _command: string,
      event: string,
      params: { outcome: string; trigger: string; position: number },
    ) => {
      if (event === "home_feed_load") {
        const { outcome, trigger, position } = params;
        loadEvents.push({ outcome, trigger, position });
      }
    };
    let calls = 0;
    let pendingSignal: AbortSignal | undefined;
    let rejectPending: ((error: Error) => void) | undefined;
    let resolvePending: ((response: Response) => void) | undefined;
    const success = () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({ stories: second, pagination: pagination(2, true) }),
      }) as Response;
    globalThis.fetch = (async (_url, options) => {
      calls++;
      if (calls === 1) {
        pendingSignal = options?.signal as AbortSignal;
        return new Promise<Response>((resolve, reject) => {
          resolvePending = resolve;
          rejectPending = reject;
        });
      }
      if (calls === 2) return success();
      return { ok: false, status: 503 } as Response;
    }) as typeof fetch;
    dom.window.scrollTo = (() => {}) as typeof dom.window.scrollTo;
    document.addEventListener("click", (event) => event.preventDefault());
    const render = (root: ReturnType<typeof createRoot>) =>
      act(async () => {
        root.render(
          <AppRouterContext.Provider value={router as never}>
            <HomeStoryFeed initialStories={first} initialPagination={pagination(1, true)} />
          </AppRouterContext.Provider>,
        );
      });
    const root = createRoot(document.getElementById("root")!);
    try {
      await render(root);
      assert.equal(document.querySelectorAll(".story-list > li").length, 10);
      assert.equal(observations, 1);
      assert.equal(document.querySelectorAll('a[href="#site-footer"]').length, 0);
      assert.doesNotMatch(document.body.textContent!, /Pause automatic|Resume automatic/);
      const nextPage = document.querySelector<HTMLAnchorElement>(".home-feed-pages a")!;
      await act(async () => nextPage.focus());
      assert.equal(onIntersection, null);
      assert.equal(calls, 0);
      await act(async () => nextPage.blur());
      assert.equal(observations, 2);
      assert.ok(onIntersection);
      await act(async () => {
        (onIntersection as IntersectionObserverCallback)(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        );
      });
      assert.match(document.querySelector("[role=status]")!.textContent!, /Loading more/);
      await act(async () => nextPage.focus());
      assert.equal(pendingSignal?.aborted, true);
      assert.deepEqual(loadEvents, [{ outcome: "cancelled", trigger: "auto", position: 10 }]);
      await act(async () => {
        if (settlement === "resolve") resolvePending!(success());
        else rejectPending!(new DOMException("Aborted", "AbortError"));
      });
      assert.equal(loadEvents.length, 1);
      assert.equal(document.querySelectorAll(".story-list > li").length, 10);
      assert.equal(document.activeElement, nextPage);
      // Explicit loading still works while the continuation has focus.
      await act(async () =>
        (document.querySelector(".home-feed-actions button") as HTMLButtonElement).click(),
      );
      assert.equal(document.querySelectorAll(".story-list > li").length, 12);
      assert.match(
        document.querySelector("[role=status]")!.textContent!,
        /2 more stories loaded\. 12 total\./,
      );
      assert.equal(calls, 2);
      await act(async () =>
        (document.querySelector(".home-feed-actions button") as HTMLButtonElement).click(),
      );
      assert.equal(document.querySelectorAll(".story-list > li").length, 12);
      assert.match(document.querySelector("[role=status]")!.textContent!, /try again/i);
      await act(async () => nextPage.focus());
      assert.match(document.querySelector("[role=status]")!.textContent!, /try again/i);
      assert.equal(calls, 3);
      assert.deepEqual(loadEvents, [
        { outcome: "cancelled", trigger: "auto", position: 10 },
        { outcome: "success", trigger: "manual", position: 12 },
        { outcome: "failure", trigger: "manual", position: 12 },
      ]);
      assert.equal(dom.window.history.state.hacksnapHomeFeed.stories.length, 12);

      await act(async () => root.unmount());
      const restored = createRoot(document.getElementById("root")!);
      await render(restored);
      assert.equal(document.querySelectorAll(".story-list > li").length, 12);
      await act(async () => restored.unmount());
    } finally {
      globalThis.fetch = originalFetch;
      dom.window.close();
      Object.keys(values).forEach((key, i) => {
        if (previous[i]) Object.defineProperty(globalThis, key, previous[i]!);
        else Reflect.deleteProperty(globalThis, key);
      });
    }
  });
}

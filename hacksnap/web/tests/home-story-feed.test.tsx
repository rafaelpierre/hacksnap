import assert from "node:assert/strict";
import { test } from "@jest/globals";
import React, { act } from "react";
import { createRequire } from "node:module";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { browsePagination } from "../lib/browse-feed";
import { StoryFeed } from "../app/story-feed";

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

for (const listingPath of ["/", "/archive", "/archive/2026/09", "/category/agents-coding"]) {
  const ranked = listingPath === "/";
  const pageState = (page: number, more: boolean) =>
    ranked ? pagination(page, more) : browsePagination(page, more);
  for (const settlement of ["resolve", "reject"] as const) {
    test(`${listingPath}: automatic loading survives focus cancellation when fetch ${settlement}s and preserves history`, async () => {
      const dom = new JSDOM('<div id="root"></div>', {
        url: `https://hacksnap.live${listingPath}`,
      });
      let onIntersection: IntersectionObserverCallback | null = null;
      let observations = 0;
      const values = {
        IntersectionObserver: class {
          constructor(private callback: IntersectionObserverCallback) {}
          observe() {
            onIntersection = this.callback;
            observations++;
          }
          disconnect() {
            if (onIntersection === this.callback) onIntersection = null;
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
      const second = ranked
        ? [story(11), story(12)]
        : [
            story(10),
            { ...story(11), summary: null, rank: null },
            { ...story(12), date_added: "2026-09-28T12:00:00.000Z" },
          ];
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
          json: async () => ({ stories: second, pagination: pageState(2, true) }),
        }) as Response;
      globalThis.fetch = (async (_url, options) => {
        calls++;
        assert.equal(
          String(_url),
          ranked
            ? `/api/ready-stories?cursor=cursor_${calls === 5 ? 4 : calls > 2 ? 3 : 2}`
            : `/api/browse-stories?${new URLSearchParams({ path: listingPath, page: String(calls === 5 ? 4 : calls > 2 ? 3 : 2) })}`,
        );
        if (calls === 1) {
          pendingSignal = options?.signal as AbortSignal;
          return new Promise<Response>((resolve, reject) => {
            resolvePending = resolve;
            rejectPending = reject;
          });
        }
        if (calls === 2) return success();
        if (calls === 4)
          return {
            ok: true,
            status: 200,
            json: async () => ({ stories: [story(13)], pagination: pageState(3, true) }),
          } as Response;
        if (calls === 5)
          return {
            ok: true,
            status: 200,
            json: async () => ({ stories: [], pagination: pageState(4, false) }),
          } as Response;
        return { ok: false, status: 503 } as Response;
      }) as typeof fetch;
      dom.window.scrollTo = (() => {}) as typeof dom.window.scrollTo;
      document.addEventListener("click", (event) => event.preventDefault());
      const render = (root: ReturnType<typeof createRoot>) =>
        act(async () => {
          root.render(
            <AppRouterContext.Provider value={router as never}>
              <StoryFeed
                listingPath={listingPath}
                groupByDay={listingPath.startsWith("/archive")}
                initialStories={first}
                initialPagination={pageState(1, true)}
              />
            </AppRouterContext.Provider>,
          );
        });
      const root = createRoot(document.getElementById("root")!);
      try {
        await render(root);
        assert.equal(document.querySelectorAll(".story-list > li").length, 10);
        assert.equal(observations, 1);
        assert.doesNotMatch(document.body.textContent!, /Load more stories/);
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
        assert.ok(document.querySelector(".home-feed-spinner"));
        await act(async () => nextPage.focus());
        assert.equal(pendingSignal?.aborted, true);
        assert.deepEqual(
          loadEvents,
          ranked ? [{ outcome: "cancelled", trigger: "auto", position: 10 }] : [],
        );
        await act(async () => {
          if (settlement === "resolve") resolvePending!(success());
          else rejectPending!(new DOMException("Aborted", "AbortError"));
        });
        assert.equal(loadEvents.length, ranked ? 1 : 0);
        assert.equal(document.querySelectorAll(".story-list > li").length, 10);
        assert.equal(document.activeElement, nextPage);
        await act(async () => nextPage.blur());
        assert.ok(onIntersection);
        await act(async () => {
          (onIntersection as IntersectionObserverCallback)(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          );
        });
        assert.equal(document.querySelectorAll(".story-list > li").length, 12);
        assert.equal(document.querySelector(".home-feed-spinner"), null);
        assert.match(
          document.querySelector("[role=status]")!.textContent!,
          /2 more stories loaded\. 12 total\./,
        );
        assert.equal(calls, 2);
        assert.ok(onIntersection);
        await act(async () => {
          (onIntersection as IntersectionObserverCallback)(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          );
        });
        assert.equal(document.querySelectorAll(".story-list > li").length, 12);
        assert.match(document.querySelector("[role=status]")!.textContent!, /try again/i);
        assert.equal(document.querySelector(".home-feed-spinner"), null);
        assert.equal(
          document.querySelector(".home-feed-actions button")?.textContent,
          "Try loading again",
        );
        await act(async () => nextPage.focus());
        assert.match(document.querySelector("[role=status]")!.textContent!, /try again/i);
        assert.equal(calls, 3);
        assert.deepEqual(
          loadEvents,
          ranked
            ? [
                { outcome: "cancelled", trigger: "auto", position: 10 },
                { outcome: "success", trigger: "auto", position: 12 },
                { outcome: "failure", trigger: "auto", position: 12 },
              ]
            : [],
        );
        if (!ranked) {
          assert.match(document.body.textContent!, /Brief pending/);
          assert.equal(document.querySelectorAll("ol.story-list").length, 0);
          assert.equal(
            document.querySelector(".home-feed-pages a")?.getAttribute("href"),
            `${listingPath}?page=3`,
          );
        }
        if (listingPath.startsWith("/archive"))
          assert.equal(document.querySelectorAll("section > .feed-bar time").length, 2);
        const retry = document.querySelector(".home-feed-actions button") as HTMLButtonElement;
        await act(async () => retry.focus());
        assert.equal(document.activeElement, retry);
        await act(async () => retry.click());
        assert.equal(calls, 4);
        assert.equal(document.querySelectorAll(".story-list > li").length, 13);
        assert.equal(document.querySelector(".home-feed-actions button"), null);
        assert.ok(onIntersection, "automatic loading resumes after the focused retry unmounts");
        await act(async () => {
          (onIntersection as IntersectionObserverCallback)(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          );
        });
        assert.equal(calls, 5);
        assert.match(document.querySelector("[role=status]")!.textContent!, /reached the end/);
        assert.equal(document.querySelector(".home-feed-actions button"), null);
        assert.equal(document.querySelector(".home-feed-pages a"), null);
        assert.equal(dom.window.history.state.hacksnapHomeFeed.stories.length, 13);

        await act(async () => root.unmount());
        const restored = createRoot(document.getElementById("root")!);
        await render(restored);
        assert.equal(document.querySelectorAll(".story-list > li").length, 13);
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
}

for (const listingPath of ["/", "/archive", "/archive/2026/09", "/category/agents-coding"]) {
  test(`${listingPath}: duplicate-only batches advance live offsets but not frozen cursors`, async () => {
    const ranked = listingPath === "/";
    const pageState = (page: number, more: boolean) =>
      ranked ? pagination(page, more) : browsePagination(page, more);
    const dom = new JSDOM('<div id="root"></div>', {
      url: `https://hacksnap.live${listingPath}`,
    });
    let onIntersection: IntersectionObserverCallback | null = null;
    const values = {
      self: dom.window,
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      IS_REACT_ACT_ENVIRONMENT: true,
      IntersectionObserver: class {
        constructor(private callback: IntersectionObserverCallback) {}
        observe() {
          onIntersection = this.callback;
        }
        disconnect() {
          if (onIntersection === this.callback) onIntersection = null;
        }
      },
    };
    const previous = Object.keys(values).map((key) =>
      Object.getOwnPropertyDescriptor(globalThis, key),
    );
    Object.entries(values).forEach(([key, value]) =>
      Object.defineProperty(globalThis, key, { value, configurable: true }),
    );
    const originalFetch = globalThis.fetch;
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.getElementById("root")!);
    const first = Array.from({ length: ranked ? 10 : 30 }, (_, index) => story(index + 1));
    const requested: number[] = [];
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input), dom.window.location.origin);
      const page = ranked
        ? Number(url.searchParams.get("cursor")!.split("_")[1])
        : Number(url.searchParams.get("page"));
      requested.push(page);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          stories: page < 4 ? first : [story(30), story(31)],
          pagination: pageState(page, page < 4),
        }),
      } as Response;
    }) as typeof fetch;
    try {
      await act(async () =>
        root.render(
          <AppRouterContext.Provider value={{ push: () => {}, prefetch: async () => {} } as never}>
            <StoryFeed
              listingPath={listingPath}
              initialStories={first}
              initialPagination={pageState(1, true)}
            />
          </AppRouterContext.Provider>,
        ),
      );
      for (let attempt = 0; attempt < 3; attempt++) {
        if (ranked && attempt > 0) {
          await act(async () =>
            (document.querySelector(".home-feed-actions button") as HTMLButtonElement).click(),
          );
        } else {
          assert.ok(onIntersection);
          await act(async () => {
            (onIntersection as IntersectionObserverCallback)(
              [{ isIntersecting: true } as IntersectionObserverEntry],
              {} as IntersectionObserver,
            );
          });
        }
        const status = document.querySelector(".home-feed-status")!.textContent!;
        if (ranked) {
          assert.match(status, /try again/i);
          assert.equal(dom.window.history.state.hacksnapHomeFeed.pagination.page, 1);
          assert.equal(document.querySelectorAll(".story-list > li").length, 10);
        } else {
          assert.doesNotMatch(status, /try again/i);
          assert.equal(dom.window.history.state.hacksnapHomeFeed.pagination.page, attempt + 2);
          assert.equal(document.querySelectorAll(".story-list > li").length, attempt < 2 ? 30 : 31);
          if (attempt < 2) {
            assert.match(status, /No new stories in this batch/);
            assert.equal(
              document.querySelector(".home-feed-pages a")?.getAttribute("href"),
              `${listingPath}?page=${attempt + 3}`,
            );
          } else {
            assert.match(status, /reached the end/);
            assert.equal(document.querySelector(".home-feed-actions button"), null);
          }
        }
      }
      assert.deepEqual(requested, ranked ? [2, 2, 2] : [2, 3, 4]);
    } finally {
      await act(async () => root.unmount());
      globalThis.fetch = originalFetch;
      dom.window.close();
      Object.keys(values).forEach((key, i) => {
        if (previous[i]) Object.defineProperty(globalThis, key, previous[i]!);
        else Reflect.deleteProperty(globalThis, key);
      });
    }
  });
}

test("a same-list Load more button remains available without IntersectionObserver", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/" });
  const values = {
    self: dom.window,
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    IntersectionObserver: undefined,
  };
  const previous = Object.keys(values).map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  Object.entries(values).forEach(([key, value]) =>
    Object.defineProperty(globalThis, key, { value, configurable: true }),
  );
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return {
      ok: true,
      status: 200,
      json: async () => ({ stories: [story(11)], pagination: pagination(2, false) }),
    } as Response;
  }) as typeof fetch;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () =>
      root.render(
        <AppRouterContext.Provider value={{ push: () => {}, prefetch: async () => {} } as never}>
          <StoryFeed initialStories={[story(1)]} initialPagination={pagination(1, true)} />
        </AppRouterContext.Provider>,
      ),
    );
    assert.equal(calls, 0);
    const loadMore = document.querySelector(".home-feed-actions button") as HTMLButtonElement;
    assert.equal(loadMore.textContent, "Load more stories");
    await act(async () => loadMore.click());
    assert.equal(calls, 1);
    assert.equal(document.querySelectorAll(".story-list > li").length, 2);
    assert.equal(document.querySelector(".home-feed-actions button"), null);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
    Object.keys(values).forEach((key, i) => {
      if (previous[i]) Object.defineProperty(globalThis, key, previous[i]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});

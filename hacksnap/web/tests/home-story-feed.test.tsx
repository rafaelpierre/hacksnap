import assert from "node:assert/strict";
import { browsePageURL } from "../lib/archive";
import { test } from "@jest/globals";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { browsePagination } from "../lib/browse-feed";
import { readFeedSnapshot } from "../lib/feed-snapshot-storage";
import { StoryRow } from "../app/story-row";
import { StoryFeed } from "../app/story-feed";
import { ARCHIVE_PAGE_SIZE } from "../lib/archive";

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
  return browsePagination(page, hasMore);
}

for (const listingPath of ["/", "/2026/09", "/?category=agents-coding"]) {
  const pageState = browsePagination;
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
          observe(element: Element) {
            if (element.classList.contains("home-feed-sentinel")) {
              onIntersection = this.callback;
              observations++;
            }
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
      const second = [
        story(10),
        { ...story(11), rank: null },
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
          `/api/browse-stories?${new URLSearchParams({ path: listingPath, page: String(calls === 5 ? 4 : calls > 2 ? 3 : 2) })}`,
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
                showCategory={!listingPath.startsWith("/category/")}
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
        assert.equal(
          document.querySelectorAll(".story-list .category-badge").length,
          listingPath.startsWith("/category/") ? 0 : 10,
        );
        assert.equal(observations, 1);
        assert.doesNotMatch(document.body.textContent!, /Load more stories/);
        assert.equal(document.querySelectorAll('a[href="#site-footer"]').length, 0);
        assert.doesNotMatch(document.body.textContent!, /Pause automatic|Resume automatic/);
        assert.equal(
          document.querySelector(".home-feed-pages a")?.getAttribute("href") ?? null,
          browsePageURL(listingPath, 2),
        );
        const focusTarget = document.querySelector<HTMLElement>(".home-feed-pages a")!;
        focusTarget.tabIndex = 0;
        await act(async () => focusTarget.focus());
        assert.equal(onIntersection, null);
        assert.equal(calls, 0);
        await act(async () => focusTarget.blur());
        assert.equal(observations, 2);
        assert.ok(onIntersection);
        await act(async () => {
          (onIntersection as IntersectionObserverCallback)(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          );
        });
        assert.match(document.querySelector(".home-feed-status")!.textContent!, /Loading more/);
        assert.ok(document.querySelector(".home-feed-spinner"));
        await act(async () => focusTarget.focus());
        assert.equal(pendingSignal?.aborted, true);
        assert.deepEqual(
          loadEvents,
          [],
          "Latest and topic feeds do not emit retired ranked analytics",
        );
        await act(async () => {
          if (settlement === "resolve") resolvePending!(success());
          else rejectPending!(new DOMException("Aborted", "AbortError"));
        });
        assert.equal(loadEvents.length, 0);
        assert.equal(document.querySelectorAll(".story-list > li").length, 10);
        assert.equal(
          document.querySelectorAll(".story-list .category-badge").length,
          listingPath.startsWith("/category/") ? 0 : 10,
        );
        assert.equal(document.activeElement, focusTarget);
        await act(async () => focusTarget.blur());
        assert.ok(onIntersection);
        await act(async () => {
          (onIntersection as IntersectionObserverCallback)(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          );
        });
        assert.equal(document.querySelectorAll(".story-list > li").length, 12);
        assert.equal(
          document.querySelectorAll(".story-list .category-badge").length,
          listingPath.startsWith("/category/") ? 0 : 12,
        );
        assert.equal(document.querySelector(".home-feed-spinner"), null);
        assert.match(
          document.querySelector(".home-feed-status")!.textContent!,
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
        assert.equal(
          document.querySelectorAll(".story-list .category-badge").length,
          listingPath.startsWith("/category/") ? 0 : 12,
        );
        assert.match(document.querySelector(".home-feed-status")!.textContent!, /try again/i);
        assert.equal(document.querySelector(".home-feed-spinner"), null);
        assert.equal(
          document.querySelector(".home-feed-actions button")?.textContent,
          "Try loading again",
        );
        await act(async () => focusTarget.focus());
        assert.match(document.querySelector(".home-feed-status")!.textContent!, /try again/i);
        assert.equal(calls, 3);
        assert.doesNotMatch(document.body.textContent!, /Brief pending/);
        assert.equal(document.querySelectorAll("ol.story-list").length, 0);
        assert.equal(
          document.querySelector(".home-feed-pages a")?.getAttribute("href"),
          browsePageURL(listingPath, 3),
        );
        assert.equal(document.querySelectorAll("section > .feed-bar time").length, 0);
        const retry = document.querySelector(".home-feed-actions button") as HTMLButtonElement;
        await act(async () => retry.focus());
        assert.equal(document.activeElement, retry);
        await act(async () => retry.click());
        assert.equal(calls, 4);
        assert.equal(document.querySelectorAll(".story-list > li").length, 13);
        assert.equal(
          document.querySelectorAll(".story-list .category-badge").length,
          listingPath.startsWith("/category/") ? 0 : 13,
        );
        assert.equal(document.querySelector(".home-feed-actions button"), null);
        assert.ok(onIntersection, "automatic loading resumes after the focused retry unmounts");
        await act(async () => {
          (onIntersection as IntersectionObserverCallback)(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          );
        });
        assert.equal(calls, 5);
        assert.match(document.querySelector(".home-feed-status")!.textContent!, /reached the end/);
        assert.equal(document.querySelector(".home-feed-actions button"), null);
        assert.equal(document.querySelector(".home-feed-pages a"), null);
        assert.equal(dom.window.history.state.hacksnapHomeFeed.storyCount, 13);
        assert.equal(
          readFeedSnapshot(dom.window.history.state.hacksnapHomeFeed, listingPath)?.stories.length,
          13,
        );

        await act(async () => root.unmount());
        const restored = createRoot(document.getElementById("root")!);
        await render(restored);
        assert.equal(document.querySelectorAll(".story-list > li").length, 13);
        assert.equal(
          document.querySelectorAll(".story-list .category-badge").length,
          listingPath.startsWith("/category/") ? 0 : 13,
        );
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

test("deep feeds keep a bounded interactive window, retain archive day headings, and shift it for keyboard focus", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/" });
  let scrollY = 0;
  Object.defineProperty(dom.window, "scrollY", { configurable: true, get: () => scrollY });
  dom.window.scrollTo = ((options: ScrollToOptions) => {
    scrollY = options.top ?? 0;
  }) as typeof dom.window.scrollTo;
  const values = {
    self: dom.window,
    window: dom.window,
    document: dom.window.document,
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
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const originalRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: -scrollY,
      width: 0,
      height: 0,
      top: -scrollY,
      right: 0,
      bottom: -scrollY,
      left: 0,
      toJSON: () => {},
    }) as DOMRect;
  const stories = Array.from({ length: 3000 }, (_, index) => {
    const day = new Date(Date.UTC(2026, 0, 1 + Math.floor(index / 30))).toISOString();
    return { ...story(index + 1), date_added: day };
  });
  try {
    // Card estimate plus its gap, with 50 day headings above the target.
    scrollY = (390 + 16) * 1500 + 70 * 50 + 80;
    await act(async () =>
      root.render(
        <AppRouterContext.Provider value={{ push: () => {}, prefetch: async () => {} } as never}>
          <StoryFeed
            listingPath="/"
            groupByDay
            initialStories={stories}
            initialPagination={browsePagination(1, true)}
          />
        </AppRouterContext.Provider>,
      ),
    );
    const rendered = () =>
      document.querySelectorAll<HTMLLIElement>(".story-list > li:not(.windowed-story-spacer)");
    assert.equal(rendered().length, 80);
    assert.equal(Number(rendered()[0]!.dataset.homeStoryId) > 1400, true);
    assert.equal(document.querySelectorAll(".windowed-story-spacer").length > 0, true);
    assert.equal(document.querySelectorAll("section .feed-bar time").length >= 2, true);
    for (const row of rendered()) {
      const storyId = Number(row.dataset.homeStoryId);
      assert.equal(row.getAttribute("aria-posinset"), String(((storyId - 1) % 30) + 1));
      assert.equal(row.getAttribute("aria-setsize"), "30");
    }

    const nearEnd = rendered()[78]!.querySelector<HTMLAnchorElement>(".feed-story-title a")!;
    await act(async () => nearEnd.focus());
    assert.equal(document.activeElement, nearEnd);
    assert.equal(rendered().length, 80);
    assert.equal(Number(rendered()[0]!.dataset.homeStoryId) > 1481, true);
  } finally {
    await act(async () => root.unmount());
    dom.window.HTMLElement.prototype.getBoundingClientRect = originalRect;
    dom.window.close();
    Object.keys(values).forEach((key, index) => {
      if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});

test("lead image priority starts in HTML and clears on an offscreen return", async () => {
  const ready = {
    ...story(1),
    image_status: "ready",
    image_url: "https://store.public.blob.vercel-storage.com/articles/1.webp",
    image_width: 1200,
    image_height: 675,
    image_mime_type: "image/webp",
  };
  const element = (
    <AppRouterContext.Provider value={{ push: () => {}, prefetch: async () => {} } as never}>
      <StoryFeed initialStories={[ready]} initialPagination={pagination(1, false)} />
    </AppRouterContext.Provider>
  );
  const serverHTML = renderToStaticMarkup(element);
  assert.match(serverHTML, /loading="eager"/);
  assert.match(serverHTML, /fetchPriority="high"/);

  for (const deepReturn of [false, true]) {
    const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/" });
    if (deepReturn) {
      dom.window.history.replaceState(
        {
          hacksnapHomeFeed: {
            version: 1,
            url: "/",
            stories: [ready, story(2)],
            pagination: pagination(1, false),
            scrollY: 900,
            focusStoryId: null,
            savedAt: Date.now(),
          },
        },
        "",
        "/",
      );
    }
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
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.getElementById("root")!);
    try {
      await act(async () => root.render(element));
      const image = document.querySelector(".feed-story-image img");
      assert.equal(image?.getAttribute("loading"), deepReturn ? "lazy" : "eager");
      assert.equal(image?.getAttribute("fetchpriority"), deepReturn ? null : "high");
      if (deepReturn) {
        await act(async () => window.dispatchEvent(new dom.window.WheelEvent("wheel")));
        assert.equal(
          document.querySelector(".feed-story-image img")?.getAttribute("loading"),
          "lazy",
        );
      }
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      Object.keys(values).forEach((key, index) => {
        if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!);
        else Reflect.deleteProperty(globalThis, key);
      });
    }
  }
});

test("a deep restored anchor is mounted before StoryFeed restores its scroll and focus", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/" });
  let scrollY = 0;
  const scrolls: number[] = [];
  Object.defineProperty(dom.window, "scrollY", { configurable: true, get: () => scrollY });
  dom.window.scrollTo = ((options: ScrollToOptions) => {
    scrollY = options.top ?? 0;
    scrolls.push(scrollY);
  }) as typeof dom.window.scrollTo;
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: function (this: HTMLElement) {
      const top = (this.dataset.homeStoryId === "301" ? 1500 : 200) - scrollY;
      return { top, bottom: top + 100, left: 0, right: 200, width: 200, height: 100 };
    },
  });
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
  const stories = Array.from({ length: 400 }, (_, index) => story(index + 1));
  dom.window.history.replaceState(
    {
      hacksnapHomeFeed: {
        version: 1,
        url: "/",
        stories,
        pagination: pagination(40, false),
        scrollY: 840,
        focusStoryId: "301",
        savedAt: Date.now(),
      },
    },
    "",
    "/",
  );
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () =>
      root.render(
        <AppRouterContext.Provider value={{ push: () => {}, prefetch: async () => {} } as never}>
          <StoryFeed initialStories={[story(90)]} initialPagination={pagination(1, true)} />
        </AppRouterContext.Provider>,
      ),
    );
    assert.equal(
      document.querySelectorAll(".story-list > li:not(.windowed-story-spacer)").length,
      80,
    );
    assert.ok(document.querySelector('[data-home-story-id="301"]'));
    assert.equal(scrolls.at(-1), 840);
    assert.equal(
      document.activeElement?.closest("[data-home-story-id]")?.getAttribute("data-home-story-id"),
      "301",
    );
    await act(async () => window.dispatchEvent(new dom.window.WheelEvent("wheel")));
    await act(async () => {
      dom.window.scrollTo({ top: 280 * 380 });
      window.dispatchEvent(new dom.window.Event("scroll"));
    });
    assert.ok(document.querySelector('[data-home-story-id="380"]'));
    assert.equal(document.querySelector('[data-home-story-id="301"]'), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.keys(values).forEach((key, index) => {
      if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});

for (const listingPath of ["/", "/2026/09", "/?category=agents-coding"]) {
  test(`${listingPath}: duplicate-only batches advance live offsets`, async () => {
    const pageState = browsePagination;
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
    const first = Array.from({ length: ARCHIVE_PAGE_SIZE }, (_, index) => story(index + 1));
    const requested: number[] = [];
    globalThis.fetch = (async (input) => {
      const url = new URL(String(input), dom.window.location.origin);
      const page = Number(url.searchParams.get("page"));
      requested.push(page);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          stories: page < 4 ? first : [story(first.length), story(first.length + 1)],
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
        assert.ok(onIntersection);
        await act(async () => {
          (onIntersection as IntersectionObserverCallback)(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            {} as IntersectionObserver,
          );
        });
        const status = document.querySelector(".home-feed-status")!.textContent!;
        assert.doesNotMatch(status, /try again/i);
        assert.equal(dom.window.history.state.hacksnapHomeFeed.pagination.page, attempt + 2);
        assert.equal(
          document.querySelectorAll(".story-list > li").length,
          ARCHIVE_PAGE_SIZE + (attempt < 2 ? 0 : 1),
        );
        if (attempt < 2) {
          assert.match(status, /No new stories in this batch/);
          assert.equal(
            document.querySelector(".home-feed-pages a")?.getAttribute("href"),
            browsePageURL(listingPath, attempt + 3),
          );
        } else {
          assert.match(status, /reached the end/);
          assert.equal(document.querySelector(".home-feed-actions button"), null);
        }
      }
      assert.deepEqual(requested, [2, 3, 4]);
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

for (const listingPath of ["/", "/2026/09", "/?category=agents-coding"]) {
  for (const [page, hasMore] of [
    [1, true],
    [2, true],
    [2, false],
    [100, false],
  ] as const) {
    test(`${listingPath} page ${page}, more=${hasMore}: server HTML exposes crawlable pagination`, () => {
      const html = renderToStaticMarkup(
        <AppRouterContext.Provider value={{ push: () => {}, prefetch: async () => {} } as never}>
          <StoryFeed
            listingPath={listingPath}
            initialStories={[story(1)]}
            initialPagination={browsePagination(page, hasMore)}
          />
        </AppRouterContext.Provider>,
      );
      const dom = new JSDOM(html);
      try {
        const links = [...dom.window.document.querySelectorAll(".home-feed-pages a")];
        assert.deepEqual(
          links.map((link) => [link.textContent, link.getAttribute("href")]),
          [
            ...(page > 1
              ? [["Newer stories", page === 2 ? listingPath : browsePageURL(listingPath, page - 1)]]
              : []),
            ...(hasMore ? [["Older stories", browsePageURL(listingPath, page + 1)]] : []),
          ],
        );
        assert.match(html, /Takeaway 1/);
      } finally {
        dom.window.close();
      }
    });
  }
}

test("category and age metadata remain visible in selected topics and archive cards", () => {
  const render = (showCategory?: boolean, ranked = false) =>
    renderToStaticMarkup(
      <AppRouterContext.Provider value={{} as never}>
        <StoryRow
          story={{ ...story(1), is_recent: false }}
          showCategory={showCategory}
          variant={ranked ? "ranked" : "unranked"}
        />
      </AppRouterContext.Provider>,
    );
  assert.match(render(), /category-badge/);
  assert.match(render(false), /category-badge/);
  assert.match(render(false), /story-context/);
  assert.match(render(false), /story-age/);
  assert.match(render(false), /Story 1/);
  assert.match(render(false, true), /archive-label/);
  assert.match(render(false, true), /category-badge/);
});

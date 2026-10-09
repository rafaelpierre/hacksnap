import assert from "node:assert/strict";
import { test } from "@jest/globals";
import React, { act } from "react";
import { createRequire } from "node:module";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import {
  BrowseStoryLink,
  NextStoryLink,
  ListPositionRestorer,
  StoryReturnLink,
  StoryJourney,
  consumeFeedReturn,
  saveFeedHistory,
} from "../app/story-navigation";
import { browseLabel } from "../lib/navigation-context";
import { ARCHIVE_PAGE_SIZE } from "../lib/archive";
import type { FeedSnapshot } from "../lib/feed-state";
import { readFeedSnapshot } from "../lib/feed-snapshot-storage";
const { JSDOM } = createRequire(import.meta.url)("jsdom");

test("dated feed breadcrumb preserves route, pagination and scroll", async () => {
  const token = "11111111-1111-1111-1111-111111111111";
  const dom = new JSDOM('<div id="root"></div>', {
    url: `https://hacksnap.live/story/headline-42`,
  });
  const values = {
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
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const scrolls: number[] = [];
  const router = { push: () => {}, prefetch: async () => {} };
  // Let React run the click handler, then suppress jsdom document navigation.
  document.addEventListener("click", (event) => event.preventDefault());
  window.name = "hacksnap-tab:test";
  window.scrollTo = ((options: ScrollToOptions) =>
    scrolls.push(options.top!)) as typeof window.scrollTo;
  const render = async (key: string) =>
    act(async () =>
      root.render(
        <AppRouterContext.Provider value={router as never}>
          <div key={key}>
            <StoryReturnLink destination={{ href: "/", label: "Latest" }} />
            <StoryReturnLink
              destination={{ href: "/?category=safety-privacy", label: "Safety & Privacy" }}
            />
            <StoryReturnLink archiveOnly />
          </div>
        </AppRouterContext.Provider>,
      ),
    );
  try {
    for (const url of [
      "/",
      "/?page=3",
      "/2026/09",
      "/2026/09?page=2",
      "/?category=safety-privacy&page=2",
      "/?category=agents-coding&page=2",
    ]) {
      window.history.replaceState({ hacksnapJourney: token }, "", `/story/headline-42`);
      const context = { url, label: browseLabel(url), scrollY: 820, savedAt: Date.now() };
      sessionStorageSet(context);
      await render(url);
      const links = [...document.querySelectorAll("a")];
      assert.deepEqual(
        links.map((link) => link.getAttribute("href")),
        [
          url.startsWith("/?page=") || url.startsWith("/2026/") ? url : "/",
          url.includes("category=safety-privacy") ? url : "/?category=safety-privacy",
          url,
        ],
      );
      assert.match(links[2].textContent!, /Back to /);
      if (url.startsWith("/2026/")) assert.equal(links[0].textContent!.trim(), context.label);
      else assert.equal(links[0].textContent!.trim(), "Latest");
      await act(async () => (url.startsWith("/2026/") ? links[0] : links[2]).click());
      assert.deepEqual(JSON.parse(window.sessionStorage.getItem("hacksnap:pending-return")!), {
        tabId: window.name,
        context,
      });
      window.history.replaceState({}, "", url);
      await act(async () => root.render(<ListPositionRestorer />));
      assert.equal(scrolls.at(-1), 820);
      assert.equal(window.sessionStorage.getItem("hacksnap:pending-return"), null);
    }
    for (const [key, context, tabId] of [
      ["missing", null, window.name],
      [
        "expired",
        {
          url: "/",
          label: "Latest stories",
          scrollY: 10,
          savedAt: Date.now() - 9 * 3600000,
        },
        window.name,
      ],
      [
        "other-tab",
        { url: "/", label: "Latest stories", scrollY: 10, savedAt: Date.now() },
        "hacksnap-tab:other",
      ],
      [
        "invalid-category",
        {
          url: "/?category=unknown",
          label: "Safety & Privacy",
          scrollY: 10,
          savedAt: Date.now(),
        },
        window.name,
      ],
    ] as const) {
      window.history.replaceState({ hacksnapJourney: token }, "", `/story/headline-42`);
      sessionStorageSet(context, tabId);
      await render(key);
      assert.equal(document.querySelectorAll("a").length, 2, key);
    }
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.keys(values).forEach((key, i) => {
      if (previous[i]) Object.defineProperty(globalThis, key, previous[i]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  function sessionStorageSet(context: unknown, tabId = window.name) {
    window.sessionStorage.setItem(`hacksnap:journey:${token}`, JSON.stringify({ tabId, context }));
  }
});

test("story URLs stay clean while each history entry retains its own journey", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/?page=3" });
  const values = {
    self: dom.window,
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.keys(values).map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  Object.entries(values).forEach(([key, value]) =>
    Object.defineProperty(globalThis, key, { value, configurable: true }),
  );
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const pushes: string[] = [];
  const router = {
    push: (href: string) => {
      pushes.push(href);
      window.history.pushState({ frameworkState: "preserved" }, "", href);
    },
    prefetch: async () => {},
  };
  document.addEventListener("click", (event) => event.preventDefault());
  const render = async (content: React.ReactNode, key: string) =>
    act(async () =>
      root.render(
        <AppRouterContext.Provider value={router as never}>
          <div key={key}>{content}</div>
        </AppRouterContext.Provider>,
      ),
    );
  const click = async () =>
    act(async () => (document.querySelector("a") as HTMLAnchorElement).click());
  try {
    const savedFeed: FeedSnapshot = {
      version: 3,
      url: "/?page=3",
      stories: [
        {
          hn_id: "42",
          story_slug: "headline-42",
          title: "Story 42",
          category: null,
          url: "https://example.com/42",
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
          summary: { overall_takeaway: "Saved brief", sentiment: null, source_coverage: null },
        },
      ],
      pagination: {
        cursor: null,
        previousCursor: null,
        hasMore: true,
        page: 3,
        pageSize: ARCHIVE_PAGE_SIZE,
        expiresAt: null,
        selectionLimited: false,
      },
      scrollY: 320,
      focusStoryId: null,
      savedAt: Date.now(),
    };
    saveFeedHistory(savedFeed);
    await render(
      <BrowseStoryLink id="42" slug="headline-42">
        Story
      </BrowseStoryLink>,
      "list",
    );
    await click();
    assert.deepEqual(pushes, ["/story/headline-42"]);
    await render(<StoryJourney />, "story-init");
    assert.equal(document.querySelector("a"), null);
    assert.ok(window.history.state.hacksnapJourney);
    assert.equal(window.history.state.hacksnapHomeFeed.storyCount, 1);
    await render(<StoryReturnLink archiveOnly />, "story");
    assert.equal(window.location.search, "");
    assert.equal(document.querySelector("a")?.getAttribute("href"), "/?page=3");
    const firstState = window.history.state;
    assert.ok(firstState.hacksnapJourney);
    assert.equal(firstState.frameworkState, "preserved");
    assert.equal(firstState.hacksnapHomeFeed.storyCount, 1);
    const journeyRecord = window.sessionStorage.getItem(
      `hacksnap:journey:${firstState.hacksnapJourney}`,
    )!;
    assert.ok(journeyRecord.length < 1000);
    assert.equal(JSON.parse(journeyRecord).homeFeedRef.id, firstState.hacksnapHomeFeed.id);
    await click();
    window.history.replaceState({}, "", "/?page=3");
    const returned = consumeFeedReturn("/?page=3")!;
    assert.equal(returned.stories[0].hn_id, "42");
    assert.equal(returned.focusStoryId, "42");
    window.history.replaceState(firstState, "", "/story/headline-42");

    await render(
      <NextStoryLink id="43" slug="headline-43">
        Next
      </NextStoryLink>,
      "next",
    );
    await click();
    await render(<StoryReturnLink archiveOnly />, "next-story");
    assert.equal(window.location.pathname, "/story/headline-43");
    assert.equal(window.location.search, "");
    assert.equal(window.history.state.hacksnapJourney, firstState.hacksnapJourney);
    assert.equal(document.querySelector("a")?.getAttribute("href"), "/?page=3");

    for (const source of ["/", "/?page=3", "/?category=agents-coding&page=2"]) {
      window.history.replaceState({}, "", source);
      await render(
        <BrowseStoryLink id="42" slug="headline-42" anchor="discussion-analysis">
          Read the debate
        </BrowseStoryLink>,
        source,
      );
      assert.equal(
        document.querySelector("a")?.getAttribute("href"),
        "/story/headline-42#discussion-analysis",
      );
      await click();
      assert.equal(pushes.at(-1), "/story/headline-42#discussion-analysis");
      await render(<StoryReturnLink />, `debate-${source}`);
      assert.equal(window.location.hash, "#discussion-analysis");
      assert.ok(window.history.state.hacksnapJourney);
      assert.equal(document.querySelector("a")?.getAttribute("href"), source);
    }

    // Old bookmarked URLs are cleaned while retaining their valid return context.
    window.history.replaceState(
      { frameworkState: "preserved" },
      "",
      `/story/headline-43?journey=${firstState.hacksnapJourney}&source=saved#comments`,
    );
    await render(<StoryReturnLink archiveOnly />, "legacy-url");
    assert.equal(
      window.location.pathname + window.location.search + window.location.hash,
      "/story/headline-43?source=saved#comments",
    );
    assert.equal(window.history.state.hacksnapJourney, firstState.hacksnapJourney);
    assert.equal(window.history.state.frameworkState, "preserved");
    assert.equal(document.querySelector("a")?.getAttribute("href"), "/?page=3");

    window.history.replaceState({}, "", "/story/headline-43?journey=invalid");
    await render(<StoryReturnLink archiveOnly />, "invalid-legacy-url");
    assert.equal(window.location.search, "");
    assert.equal(document.querySelector("a"), null);
    window.history.replaceState(firstState, "", "/story/headline-43");

    // A remount (as on reload) reads the committed entry, with no pending token.
    await render(<StoryReturnLink archiveOnly />, "reload");
    assert.equal(document.querySelector("a")?.getAttribute("href"), "/?page=3");

    window.history.pushState({}, "", "/?page=2");
    await render(
      <BrowseStoryLink id="42" slug="headline-42">
        Story
      </BrowseStoryLink>,
      "second-list",
    );
    await click();
    await render(<StoryReturnLink archiveOnly />, "second-visit");
    const secondState = window.history.state;
    assert.notEqual(secondState.hacksnapJourney, firstState.hacksnapJourney);
    assert.equal(document.querySelector("a")?.getAttribute("href"), "/?page=2");

    // Exercise popstate even when both history entries have the same pathname.
    for (const [state, href] of [
      [firstState, "/?page=3"],
      [secondState, "/?page=2"],
    ] as const) {
      await act(async () => {
        window.history.replaceState(state, "", "/story/headline-42");
        window.dispatchEvent(new dom.window.PopStateEvent("popstate", { state }));
      });
      assert.equal(document.querySelector("a")?.getAttribute("href"), href);
      assert.equal(window.location.search, "");
    }

    // A direct arrival must not inherit a previous journey from storage.
    window.history.pushState({}, "", "/story/headline-42");
    await render(<StoryReturnLink archiveOnly />, "direct");
    assert.equal(document.querySelector("a"), null);
    await render(
      <NextStoryLink id="44" slug="headline-44">
        Next
      </NextStoryLink>,
      "direct-next",
    );
    await click();
    await render(<StoryReturnLink archiveOnly />, "direct-next-arrival");
    assert.equal(document.querySelector("a"), null);
    assert.equal(window.location.search, "");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.keys(values).forEach((key, i) => {
      if (previous[i]) Object.defineProperty(globalThis, key, previous[i]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});

for (const historyFormat of ["reference", "legacy"] as const) {
  test(`Most read-only story preserves the ${historyFormat} feed snapshot and explicit return`, async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/" });
    const values = {
      self: dom.window,
      window: dom.window,
      document: dom.window.document,
      navigator: dom.window.navigator,
      IS_REACT_ACT_ENVIRONMENT: true,
    };
    const previous = Object.keys(values).map((key) =>
      Object.getOwnPropertyDescriptor(globalThis, key),
    );
    Object.entries(values).forEach(([key, value]) =>
      Object.defineProperty(globalThis, key, { value, configurable: true }),
    );
    Object.defineProperty(window, "scrollY", { configurable: true, value: 880 });
    window.name = `hacksnap-tab:most-read-${historyFormat}`;
    const { createRoot } = await import("react-dom/client");
    const root = createRoot(document.getElementById("root")!);
    const pushes: string[] = [];
    const departingFeeds: Array<FeedSnapshot | null> = [];
    const router = {
      push: (href: string) => {
        pushes.push(href);
        departingFeeds.push(readFeedSnapshot(window.history.state?.hacksnapHomeFeed, "/"));
        window.history.pushState({}, "", href);
      },
      prefetch: async () => {},
    };
    document.addEventListener("click", (event) => event.preventDefault());
    const render = (content: React.ReactNode, key: string) =>
      act(async () => {
        root.render(
          <AppRouterContext.Provider value={router as never}>
            <div key={key}>{content}</div>
          </AppRouterContext.Provider>,
        );
      });
    const click = () => act(async () => (document.querySelector("a") as HTMLAnchorElement).click());
    try {
      const savedFeed: FeedSnapshot = {
        version: 3,
        url: "/",
        stories: Array.from({ length: 30 }, (_, index) => ({
          hn_id: String(index + 1),
          story_slug: `story-${index + 1}`,
          title: `Story ${index + 1}`,
          category: null,
          url: `https://example.com/${index + 1}`,
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
          summary: { overall_takeaway: "Saved brief", sentiment: null, source_coverage: null },
        })),
        pagination: {
          cursor: null,
          previousCursor: null,
          hasMore: true,
          page: 2,
          pageSize: ARCHIVE_PAGE_SIZE,
          expiresAt: null,
          selectionLimited: false,
        },
        scrollY: 320,
        focusStoryId: "30",
        savedAt: Date.now(),
      };
      if (historyFormat === "reference") saveFeedHistory(savedFeed);
      else window.history.replaceState({ hacksnapHomeFeed: savedFeed }, "");
      await render(
        <BrowseStoryLink id="99" slug="archived-story-99" focusFeedStory={false}>
          Most read archived story
        </BrowseStoryLink>,
        "sidebar",
      );
      await click();
      assert.deepEqual(pushes, ["/story/archived-story-99"]);
      const positioned = departingFeeds[0];
      assert.ok(positioned, "a sidebar-only story must leave the feed snapshot valid");
      assert.deepEqual(positioned.stories, savedFeed.stories);
      assert.deepEqual(positioned.pagination, savedFeed.pagination);
      assert.equal(positioned.scrollY, 880);
      assert.equal(positioned.focusStoryId, null);

      await render(<StoryReturnLink archiveOnly />, "story");
      assert.equal(document.querySelector("a")?.getAttribute("href"), "/");
      await click();
      window.history.replaceState({}, "", "/");
      const returned = consumeFeedReturn("/");
      assert.ok(returned, "the explicit return must restore the saved feed depth");
      assert.deepEqual(returned.stories, savedFeed.stories);
      assert.deepEqual(returned.pagination, savedFeed.pagination);
      assert.equal(returned.scrollY, 880);
      assert.equal(returned.focusStoryId, null);
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      Object.keys(values).forEach((key, i) => {
        if (previous[i]) Object.defineProperty(globalThis, key, previous[i]!);
        else Reflect.deleteProperty(globalThis, key);
      });
    }
  });
}

test("readable storage with failing writes and cleanup still restores the list in this tab", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/?page=3" });
  const values = {
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
  const originalSetItem = Object.getOwnPropertyDescriptor(dom.window.Storage.prototype, "setItem");
  const originalRemoveItem = Object.getOwnPropertyDescriptor(
    dom.window.Storage.prototype,
    "removeItem",
  );
  const originalGetItem = Object.getOwnPropertyDescriptor(dom.window.Storage.prototype, "getItem");
  Object.defineProperty(dom.window.Storage.prototype, "setItem", {
    configurable: true,
    value: () => {
      throw Error("writes blocked");
    },
  });
  Object.defineProperty(dom.window.Storage.prototype, "removeItem", {
    configurable: true,
    value: () => {
      throw Error("cleanup blocked");
    },
  });
  Object.defineProperty(dom.window.Storage.prototype, "getItem", {
    configurable: true,
    value: () => {
      throw Error("reads blocked");
    },
  });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const scrolls: number[] = [];
  window.name = "hacksnap-tab:fallback";
  window.scrollTo = ((options: ScrollToOptions) =>
    scrolls.push(options.top!)) as typeof window.scrollTo;
  const router = {
    push: (href: string) => window.history.pushState({}, "", href),
    prefetch: async () => {},
  };
  document.addEventListener("click", (event) => event.preventDefault());
  const render = (content: React.ReactNode) =>
    act(async () => {
      root.render(
        <AppRouterContext.Provider value={router as never}>{content}</AppRouterContext.Provider>,
      );
    });
  try {
    await render(
      <BrowseStoryLink id="42" slug="story-42">
        Story
      </BrowseStoryLink>,
    );
    await act(async () => (document.querySelector("a") as HTMLAnchorElement).click());
    await render(<StoryReturnLink />);
    assert.equal(document.querySelector("a")?.getAttribute("href"), "/?page=3");
    await act(async () => (document.querySelector("a") as HTMLAnchorElement).click());
    window.history.replaceState({}, "", "/?page=3");
    await render(<ListPositionRestorer />);
    assert.deepEqual(scrolls, [0]);
    assert.equal(
      originalGetItem!.value.call(window.sessionStorage, "hacksnap:pending-return"),
      null,
    );
  } finally {
    await act(async () => root.unmount());
    if (originalSetItem)
      Object.defineProperty(dom.window.Storage.prototype, "setItem", originalSetItem);
    if (originalRemoveItem)
      Object.defineProperty(dom.window.Storage.prototype, "removeItem", originalRemoveItem);
    if (originalGetItem)
      Object.defineProperty(dom.window.Storage.prototype, "getItem", originalGetItem);
    dom.window.close();
    Object.keys(values).forEach((key, i) => {
      if (previous[i]) Object.defineProperty(globalThis, key, previous[i]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});

test("journey cleanup expires old records, caps owned keys, and preserves other storage", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/" });
  const values = {
    self: dom.window,
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.keys(values).map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  Object.entries(values).forEach(([key, value]) =>
    Object.defineProperty(globalThis, key, { value, configurable: true }),
  );
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const router = { push: () => {}, prefetch: async () => {} };
  document.addEventListener("click", (event) => event.preventDefault());
  const now = Date.now();
  const context = { url: "/", label: "Latest stories", scrollY: 30, savedAt: now };
  const expired = { ...context, savedAt: now - 9 * 60 * 60 * 1000 };
  window.sessionStorage.setItem("unrelated:preference", "keep");
  window.sessionStorage.setItem("hacksnap:journey:expired", JSON.stringify({ context: expired }));
  window.sessionStorage.setItem(
    "hacksnap:journey:future",
    JSON.stringify({ context: { ...context, savedAt: now + 1_000 } }),
  );
  window.sessionStorage.setItem("hacksnap:journey:malformed", "not json");
  for (let index = 0; index < 42; index += 1) {
    const token = index.toString(16).padStart(36, "0");
    window.sessionStorage.setItem(`hacksnap:journey:${token}`, JSON.stringify({ context }));
  }
  try {
    await act(async () =>
      root.render(
        <AppRouterContext.Provider value={router as never}>
          <BrowseStoryLink id="42" slug="story-42">
            Story
          </BrowseStoryLink>
        </AppRouterContext.Provider>,
      ),
    );
    await act(async () => (document.querySelector("a") as HTMLAnchorElement).click());
    const journeyKeys = Array.from({ length: window.sessionStorage.length }, (_, index) =>
      window.sessionStorage.key(index),
    ).filter((key) => key?.startsWith("hacksnap:journey:"));
    assert.equal(journeyKeys.length, 40);
    assert.equal(window.sessionStorage.getItem("hacksnap:journey:expired"), null);
    assert.equal(window.sessionStorage.getItem("hacksnap:journey:future"), null);
    assert.equal(window.sessionStorage.getItem("hacksnap:journey:malformed"), null);
    assert.equal(window.sessionStorage.getItem("unrelated:preference"), "keep");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.keys(values).forEach((key, i) => {
      if (previous[i]) Object.defineProperty(globalThis, key, previous[i]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});

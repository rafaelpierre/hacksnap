import assert from "node:assert/strict";
import { test } from "@jest/globals";
import React, { act } from "react";
import { createRequire } from "node:module";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { BrowseStoryLink, StoryReturnLink, consumeHomeFeedReturn } from "../app/story-navigation";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

function card(id: number) {
  return {
    hn_id: String(id),
    title: `Story ${id}`,
    story_slug: `story-${id}`,
    category: "agents_coding",
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
    summary: {
      overall_takeaway: "A ready story",
      sentiment: 0,
      source_coverage: {
        stored_comments: 10,
        included_comments: 10,
        comments_truncated: false,
        article_status: "fetched",
      },
    },
  };
}

test("reload starts fresh once, then Back and site return restore a frozen list without storage", async () => {
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
  Object.defineProperty(dom.window, "sessionStorage", {
    configurable: true,
    get: () => {
      throw Error("blocked");
    },
  });
  Object.defineProperty(dom.window.performance, "getEntriesByType", {
    configurable: true,
    value: () => [{ type: "reload", name: "https://hacksnap.live/" }],
  });
  const snapshot = {
    version: 1,
    url: "/",
    stories: [card(1), card(11)],
    pagination: {
      cursor: "cursor3",
      previousCursor: "cursor1",
      hasMore: true,
      page: 2,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      selectionLimited: false,
    },
    scrollY: 880,
    focusStoryId: "11",
    savedAt: Date.now(),
  };
  dom.window.history.replaceState({ hacksnapHomeFeed: snapshot }, "", "/");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const router = {
    push: (href: string) => dom.window.history.pushState({}, "", href),
    prefetch: async () => {},
  };
  const render = (content: React.ReactNode) =>
    act(async () => {
      root.render(
        <AppRouterContext.Provider value={router as never}>{content}</AppRouterContext.Provider>,
      );
    });
  document.addEventListener("click", (event) => event.preventDefault());
  try {
    assert.equal(consumeHomeFeedReturn("/"), null, "reload starts a new selection");
    assert.equal(consumeHomeFeedReturn("/"), null, "effect replay cannot restore the old list");
    dom.window.history.replaceState({ hacksnapHomeFeed: snapshot }, "", "/");
    assert.equal(consumeHomeFeedReturn("/")?.stories.length, 2, "a later Back restores history");
    await render(
      <BrowseStoryLink id="11" slug="story-11" feedPosition={11}>
        Story
      </BrowseStoryLink>,
    );
    await act(async () => (document.querySelector("a") as HTMLAnchorElement).click());
    await render(<StoryReturnLink />);
    assert.equal(dom.window.location.pathname, "/story/story-11");
    assert.equal(document.querySelector("a")?.getAttribute("href"), "/");
    assert.equal(dom.window.history.state.hacksnapHomeFeed.stories.length, 2);
    await act(async () => (document.querySelector("a") as HTMLAnchorElement).click());
    dom.window.history.replaceState({}, "", "/");
    assert.equal(
      consumeHomeFeedReturn("/")?.stories.length,
      2,
      "site return restores without storage",
    );
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.keys(values).forEach((key, i) => {
      if (previous[i]) Object.defineProperty(globalThis, key, previous[i]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});

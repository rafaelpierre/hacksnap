import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import React, { act } from "react";
import { createRequire } from "node:module";
import type { Root } from "react-dom/client";
import type { PublicFeedStory } from "../lib/stories-api";
import { publicFeedStory } from "../lib/stories-api";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

// Exercise real windowing and measurement with small cards. Full StoryRow markup,
// age intervals, routing and analytics are covered in their own suites and add
// hundreds of unrelated nodes/effects to every resize in this geometry test.
jest.unstable_mockModule("../app/story-row", () => ({
  StoryRow: ({ story, lead }: { story: PublicFeedStory; lead?: boolean }) => (
    <article className={`feed-story${lead ? " feed-story-lead" : ""}`}>{story.title}</article>
  ),
}));
jest.unstable_mockModule("../app/journey-analytics", () => ({ useFeedExposure: () => {} }));
const { WindowedStoryList } = await import("../app/windowed-story-list");

test("rotation invalidates offscreen heights and re-estimates proportional images at the observed width", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/" });
  const values = {
    window: dom.window,
    self: dom.window,
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
  let width = 600;
  const originalRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    return {
      width,
      height: this.dataset.homeStoryId ? (width === 600 ? 1000 : 600) : 0,
      top: 0,
      bottom: 0,
      left: 0,
      right: width,
      x: 0,
      y: 0,
      toJSON: () => {},
    } as DOMRect;
  };
  const stories = Array.from({ length: 180 }, (_, index) =>
    publicFeedStory({
      hn_id: String(index + 1),
      title: `Story ${index + 1}`,
      category: null,
      url: "https://example.com/",
      points: 1,
      comment_count: 0,
      date_added: new Date("2026-10-01T12:00:00Z"),
      summary: null,
      image_status: "ready",
      image_url: "https://caiasssg5nuaa1i1.public.blob.vercel-storage.com/articles/test.webp",
      image_width: 1200,
      image_height: 600,
      image_mime_type: "image/webp",
    }),
  );
  let root: Root | undefined;
  try {
    const { createRoot } = await import("react-dom/client");
    root = createRoot(document.getElementById("root")!);
    const render = (pinnedStoryId?: string) =>
      root!.render(
        <WindowedStoryList
          stories={stories}
          ranked={false}
          initialPage={1}
          groupByDay={false}
          leadImagePriority={false}
          leadStoryId="1"
          pinnedStoryId={pinnedStoryId}
        />,
      );
    await act(async () => render());
    await act(async () => render("151"));
    const spacerHeight = () =>
      parseFloat(document.querySelector<HTMLElement>(".windowed-story-spacer")!.style.height);
    const before = spacerHeight();
    width = 300;
    await act(async () => window.dispatchEvent(new dom.window.Event("resize")));
    const after = spacerHeight();
    assert.ok(
      before - after > 20_000,
      `stale desktop heights must be discarded: ${before} -> ${after}`,
    );
    assert.equal(document.querySelectorAll("[data-home-story-id]").length, 80);
    assert.ok(document.querySelector('[data-home-story-id="151"]'));
    await act(async () => window.dispatchEvent(new dom.window.Event("resize")));
    assert.equal(spacerHeight(), after, "unchanged width must not clear measurements again");
  } finally {
    try {
      if (root) await act(async () => root!.unmount());
    } finally {
      dom.window.HTMLElement.prototype.getBoundingClientRect = originalRect;
      dom.window.close();
      Object.keys(values).forEach((key, index) => {
        if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!);
        else Reflect.deleteProperty(globalThis, key);
      });
    }
  }
});

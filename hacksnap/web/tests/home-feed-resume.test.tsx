import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import React, { act } from "react";
import { createRequire } from "node:module";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { StoryFeed } from "../app/story-feed";
import { HOME_FEED_CHECKPOINT_KEY } from "../lib/home-feed-checkpoint";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

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
    summary: {
      overall_takeaway: "A ready story",
      sentiment: 0 as const,
      source_coverage: {
        stored_comments: 10,
        included_comments: 10,
        comments_truncated: false,
        article_status: "fetched" as const,
      },
    },
  };
}

function pagination(page: number, expiresAt = Date.now() + 60 * 60 * 1000) {
  return {
    cursor: `cursor${page + 1}`,
    previousCursor: page > 1 ? `cursor${page - 1}` : null,
    hasMore: true,
    page,
    expiresAt: new Date(expiresAt).toISOString(),
    selectionLimited: false,
  };
}

function checkpoint(savedAt: number, expiresAt?: number) {
  return {
    version: 1,
    snapshot: {
      version: 1,
      url: "/",
      stories: [story(1), story(11)],
      pagination: pagination(2, expiresAt),
      scrollY: 840,
      focusStoryId: null,
      savedAt,
    },
    anchor: { storyId: "11", offset: -24 },
  };
}

async function withFeed(
  run: (context: {
    dom: InstanceType<typeof JSDOM>;
    render: () => Promise<void>;
    storyTop: (value: number) => void;
    scrolls: number[];
    flushFrames: () => void;
  }) => Promise<void>,
  url = "https://hacksnap.live/",
  deferFrames = false,
) {
  const dom = new JSDOM('<div id="root"></div>', { url });
  let y = 0;
  let secondTop = 1200;
  const scrolls: number[] = [];
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const flushFrames = () => {
    for (const [id, callback] of frames) {
      frames.delete(id);
      callback(0);
    }
  };
  Object.defineProperty(dom.window, "scrollY", { configurable: true, get: () => y });
  dom.window.scrollTo = ((options: ScrollToOptions) => {
    y = options.top ?? y;
    scrolls.push(y);
  }) as typeof dom.window.scrollTo;
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: function (this: HTMLElement) {
      const top = (this.dataset.homeStoryId === "11" ? secondTop : 200) - y;
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
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const id = ++frameId;
      if (deferFrames) frames.set(id, callback);
      else callback(0);
      return id;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
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
  const render = () =>
    act(async () => {
      root.render(
        <AppRouterContext.Provider value={router as never}>
          <StoryFeed initialStories={[story(90)]} initialPagination={pagination(1)} />
        </AppRouterContext.Provider>,
      );
    });
  try {
    await run({ dom, render, storyTop: (value) => (secondTop = value), scrolls, flushFrames });
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.keys(values).forEach((key, i) => {
      if (previous[i]) Object.defineProperty(globalThis, key, previous[i]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
}

test("a recent root checkpoint restores cards by story and viewport offset across reflow", async () => {
  await withFeed(async ({ dom, render, storyTop, scrolls }) => {
    dom.window.localStorage.setItem(
      HOME_FEED_CHECKPOINT_KEY,
      JSON.stringify(checkpoint(Date.now() - 60_000)),
    );
    await render();
    assert.deepEqual(
      [...document.querySelectorAll(".story-list > li")].map((row) =>
        row.getAttribute("data-home-story-id"),
      ),
      ["1", "11"],
    );
    assert.equal(scrolls.at(-1), 1224);
    assert.equal(
      document.querySelector(".home-feed-resume a")?.textContent?.trim(),
      "Back to latest",
    );
    storyTop(1500);
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("resize")));
    assert.equal(scrolls.at(-1), 1524, "reflow preserves the anchored row's viewport offset");
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("wheel")));
    storyTop(1800);
    await act(async () => dom.window.dispatchEvent(new dom.window.Event("resize")));
    assert.equal(scrolls.at(-1), 1524, "user scrolling ends automatic repositioning");
  });
});

test("an older checkpoint stays intact until the reader chooses to resume", async () => {
  await withFeed(async ({ dom, render, scrolls }) => {
    const saved = JSON.stringify(checkpoint(Date.now() - 31 * 60_000));
    dom.window.localStorage.setItem(HOME_FEED_CHECKPOINT_KEY, saved);
    await render();
    assert.equal(
      document.querySelector(".story-list > li")?.getAttribute("data-home-story-id"),
      "90",
    );
    assert.match(
      document.querySelector(".home-feed-resume")!.textContent!,
      /previous reading place/,
    );
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    assert.equal(dom.window.localStorage.getItem(HOME_FEED_CHECKPOINT_KEY), saved);
    assert.equal(scrolls.length, 0);
    await act(async () => {
      dom.window.dispatchEvent(new dom.window.Event("wheel"));
      (document.querySelector(".story-list > li") as HTMLElement).click();
    });
    assert.equal(
      dom.window.localStorage.getItem(HOME_FEED_CHECKPOINT_KEY),
      saved,
      "scrolling and clicking card text preserve the offered reading place",
    );
    const continueButton = [
      ...document.querySelectorAll<HTMLButtonElement>(".home-feed-resume button"),
    ].find((button) => button.textContent?.includes("Continue where you left off"))!;
    continueButton.focus();
    await act(async () => {
      continueButton.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: " ", bubbles: true }),
      );
      continueButton.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    assert.ok(continueButton.isConnected, "Space and Enter leave the focused control available");
    assert.equal(dom.window.localStorage.getItem(HOME_FEED_CHECKPOINT_KEY), saved);
    await act(async () => continueButton.click());
    assert.deepEqual(
      [...document.querySelectorAll(".story-list > li")].map((row) =>
        row.getAttribute("data-home-story-id"),
      ),
      ["1", "11"],
    );
    assert.equal(scrolls.at(-1), 1224);
    assert.equal(
      document.activeElement?.closest("[data-home-story-id]")?.getAttribute("data-home-story-id"),
      "11",
    );
  });
});

test("modified Back to latest click keeps this tab's checkpoint active", async () => {
  await withFeed(async ({ dom, render }) => {
    dom.window.localStorage.setItem(
      HOME_FEED_CHECKPOINT_KEY,
      JSON.stringify(checkpoint(Date.now() - 60_000)),
    );
    await render();
    const back = document.querySelector<HTMLAnchorElement>(".home-feed-resume a")!;
    document.addEventListener("click", (event) => event.preventDefault());
    await act(async () =>
      back.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }),
      ),
    );
    dom.window.scrollTo({ top: 1300 });
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    const saved = JSON.parse(dom.window.localStorage.getItem(HOME_FEED_CHECKPOINT_KEY)!);
    assert.equal(saved.snapshot.scrollY, 1300);
  });
});

test("expired checkpoint uses fresh cards and a one-use fresh URL bypasses saved cards", async () => {
  await withFeed(async ({ dom, render }) => {
    dom.window.localStorage.setItem(
      HOME_FEED_CHECKPOINT_KEY,
      JSON.stringify(checkpoint(Date.now() - 60_000, Date.now() - 1)),
    );
    await render();
    assert.match(document.querySelector(".home-feed-resume")!.textContent!, /expired/);
    assert.equal(
      document.querySelector(".story-list > li")?.getAttribute("data-home-story-id"),
      "90",
    );
  });
  await withFeed(async ({ dom, render }) => {
    dom.window.localStorage.setItem(
      HOME_FEED_CHECKPOINT_KEY,
      JSON.stringify(checkpoint(Date.now() - 60_000)),
    );
    await render();
    assert.equal(
      document.querySelector(".story-list > li")?.getAttribute("data-home-story-id"),
      "90",
    );
    assert.equal(dom.window.location.search, "");
    assert.equal(document.querySelector(".home-feed-resume"), null);
  }, "https://hacksnap.live/?__hacksnap_fresh=1");
});

test("reader input before the first restore frame releases loading and saving", async () => {
  await withFeed(
    async ({ dom, render, scrolls, flushFrames }) => {
      dom.window.localStorage.setItem(
        HOME_FEED_CHECKPOINT_KEY,
        JSON.stringify(checkpoint(Date.now() - 60_000)),
      );
      await render();
      assert.equal(scrolls.length, 0);
      assert.equal(document.querySelector(".home-feed-actions button"), null);
      await act(async () => dom.window.dispatchEvent(new dom.window.Event("wheel")));
      flushFrames();
      assert.equal(scrolls.length, 0, "canceled restore does not fight the reader");
      assert.ok(document.querySelector(".home-feed-actions button"));
      dom.window.dispatchEvent(new dom.window.Event("pagehide"));
      const saved = JSON.parse(dom.window.localStorage.getItem(HOME_FEED_CHECKPOINT_KEY)!);
      assert.ok(saved.snapshot.savedAt > Date.now() - 30_000);
    },
    "https://hacksnap.live/",
    true,
  );
});

test("a suspended first frame preserves the checkpoint and starts settling only after positioning", async () => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
  try {
    await withFeed(
      async ({ dom, render, scrolls, flushFrames, storyTop }) => {
        const saved = JSON.stringify(checkpoint(Date.now() - 60_000));
        dom.window.localStorage.setItem(HOME_FEED_CHECKPOINT_KEY, saved);
        await render();
        await act(async () => {
          await jest.advanceTimersByTimeAsync(5_000);
        });
        dom.window.dispatchEvent(new dom.window.Event("pagehide"));
        assert.equal(scrolls.length, 0);
        assert.equal(
          dom.window.localStorage.getItem(HOME_FEED_CHECKPOINT_KEY),
          saved,
          "timers and background flushes must not overwrite an unpositioned checkpoint",
        );
        assert.equal(document.querySelector(".home-feed-actions button"), null);
        await act(async () => flushFrames());
        assert.equal(scrolls.at(-1), 1224);
        assert.equal(
          JSON.parse(dom.window.localStorage.getItem(HOME_FEED_CHECKPOINT_KEY)!).snapshot.scrollY,
          1224,
        );
        await act(async () => {
          await jest.advanceTimersByTimeAsync(1_999);
        });
        storyTop(1500);
        await act(async () => {
          dom.window.dispatchEvent(new dom.window.Event("resize"));
          flushFrames();
        });
        assert.equal(scrolls.at(-1), 1524, "reflow correction remains available after activation");
        await act(async () => {
          await jest.advanceTimersByTimeAsync(1);
        });
        storyTop(1800);
        await act(async () => {
          dom.window.dispatchEvent(new dom.window.Event("resize"));
          flushFrames();
        });
        assert.equal(scrolls.at(-1), 1524, "later frames do not extend the settling deadline");
      },
      "https://hacksnap.live/",
      true,
    );
  } finally {
    jest.useRealTimers();
  }
});

test("modified title clicks and unrelated card links preserve the older checkpoint", async () => {
  await withFeed(async ({ dom, render }) => {
    const saved = JSON.stringify(checkpoint(Date.now() - 31 * 60_000));
    dom.window.localStorage.setItem(HOME_FEED_CHECKPOINT_KEY, saved);
    await render();
    document.addEventListener("click", (event) => event.preventDefault());
    const title = document.querySelector<HTMLAnchorElement>(".story-list h3 a")!;
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      await act(async () =>
        title.dispatchEvent(
          new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, ...init }),
        ),
      );
      assert.equal(dom.window.localStorage.getItem(HOME_FEED_CHECKPOINT_KEY), saved);
      assert.match(
        document.querySelector(".home-feed-resume")!.textContent!,
        /Continue where you left off/,
      );
    }
    for (const selector of [
      '.story-list a[href^="/category/"]',
      '.story-list a[href^="https://news.ycombinator.com/"]',
    ]) {
      const link = document.querySelector<HTMLAnchorElement>(selector)!;
      assert.ok(link, selector);
      await act(async () => link.click());
      dom.window.dispatchEvent(new dom.window.Event("pagehide"));
      assert.equal(dom.window.localStorage.getItem(HOME_FEED_CHECKPOINT_KEY), saved);
      assert.match(
        document.querySelector(".home-feed-resume")!.textContent!,
        /Continue where you left off/,
      );
    }
  });
});

test("an unmodified primary title activation commits fresh history before story navigation", async () => {
  await withFeed(async ({ dom, render }) => {
    const saved = JSON.stringify(checkpoint(Date.now() - 31 * 60_000));
    dom.window.localStorage.setItem(HOME_FEED_CHECKPOINT_KEY, saved);
    await render();
    const title = document.querySelector<HTMLAnchorElement>(".story-list h3 a")!;
    const canceled = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
    canceled.preventDefault();
    await act(async () => title.dispatchEvent(canceled));
    assert.equal(dom.window.localStorage.getItem(HOME_FEED_CHECKPOINT_KEY), saved);
    await act(async () => title.click());
    const fresh = JSON.parse(dom.window.localStorage.getItem(HOME_FEED_CHECKPOINT_KEY)!);
    assert.deepEqual(
      fresh.snapshot.stories.map((story: { hn_id: string }) => story.hn_id),
      ["90"],
    );
    assert.equal(dom.window.history.state.hacksnapHomeFeed.focusStoryId, "90");
    assert.equal(document.querySelector(".home-feed-resume"), null);
  });
});

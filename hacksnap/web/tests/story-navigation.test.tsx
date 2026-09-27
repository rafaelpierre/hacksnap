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
} from "../app/story-navigation";
import { browseLabel } from "../lib/navigation-context";
const { JSDOM } = createRequire(import.meta.url)("jsdom");

test("archive return preserves route, pagination and scroll without changing breadcrumbs", async () => {
  const token = "11111111-1111-1111-1111-111111111111";
  const dom = new JSDOM('<div id="root"></div>', { url: `https://hacksnap.live/story/42` });
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
            <StoryReturnLink destination={{ href: "/", label: "Top Stories" }} />
            <StoryReturnLink
              destination={{ href: "/category/safety-privacy", label: "Safety & Privacy" }}
            />
            <StoryReturnLink archiveOnly />
          </div>
        </AppRouterContext.Provider>,
      ),
    );
  try {
    for (const url of [
      "/archive",
      "/archive?page=3",
      "/archive/2026/09",
      "/archive/2026/09?page=2",
    ]) {
      window.history.replaceState({ hacksnapJourney: token }, "", `/story/42`);
      const context = { url, label: browseLabel(url), scrollY: 820, savedAt: Date.now() };
      sessionStorageSet(context);
      await render(url);
      const links = [...document.querySelectorAll("a")];
      assert.deepEqual(
        links.map((link) => link.getAttribute("href")),
        ["/", "/category/safety-privacy", url],
      );
      assert.match(links[2].textContent!, /Back to /);
      await act(async () => links[2].click());
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
          url: "/archive",
          label: "Latest stories",
          scrollY: 10,
          savedAt: Date.now() - 9 * 3600000,
        },
        window.name,
      ],
      [
        "other-tab",
        { url: "/archive", label: "Latest stories", scrollY: 10, savedAt: Date.now() },
        "hacksnap-tab:other",
      ],
      [
        "category",
        {
          url: "/category/safety-privacy",
          label: "Safety & Privacy",
          scrollY: 10,
          savedAt: Date.now(),
        },
        window.name,
      ],
    ] as const) {
      window.history.replaceState({ hacksnapJourney: token }, "", `/story/42`);
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
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/archive?page=3" });
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
    await render(<BrowseStoryLink id="42">Story</BrowseStoryLink>, "list");
    await click();
    assert.deepEqual(pushes, ["/story/42"]);
    await render(<StoryReturnLink archiveOnly />, "story");
    assert.equal(window.location.search, "");
    assert.equal(document.querySelector("a")?.getAttribute("href"), "/archive?page=3");
    const firstState = window.history.state;
    assert.ok(firstState.hacksnapJourney);
    assert.equal(firstState.frameworkState, "preserved");

    await render(<NextStoryLink id="43">Next</NextStoryLink>, "next");
    await click();
    await render(<StoryReturnLink archiveOnly />, "next-story");
    assert.equal(window.location.pathname, "/story/43");
    assert.equal(window.location.search, "");
    assert.equal(window.history.state.hacksnapJourney, firstState.hacksnapJourney);
    assert.equal(document.querySelector("a")?.getAttribute("href"), "/archive?page=3");

    for (const source of ["/", "/archive?page=3", "/category/agents-coding?page=2"]) {
      window.history.replaceState({}, "", source);
      await render(
        <BrowseStoryLink id="42" anchor="discussion-analysis">
          Read the debate
        </BrowseStoryLink>,
        source,
      );
      assert.equal(
        document.querySelector("a")?.getAttribute("href"),
        "/story/42#discussion-analysis",
      );
      await click();
      assert.equal(pushes.at(-1), "/story/42#discussion-analysis");
      await render(<StoryReturnLink />, `debate-${source}`);
      assert.equal(window.location.hash, "#discussion-analysis");
      assert.ok(window.history.state.hacksnapJourney);
      assert.equal(document.querySelector("a")?.getAttribute("href"), source);
    }

    // Old bookmarked URLs are cleaned while retaining their valid return context.
    window.history.replaceState(
      { frameworkState: "preserved" },
      "",
      `/story/43?journey=${firstState.hacksnapJourney}&source=saved#comments`,
    );
    await render(<StoryReturnLink archiveOnly />, "legacy-url");
    assert.equal(
      window.location.pathname + window.location.search + window.location.hash,
      "/story/43?source=saved#comments",
    );
    assert.equal(window.history.state.hacksnapJourney, firstState.hacksnapJourney);
    assert.equal(window.history.state.frameworkState, "preserved");
    assert.equal(document.querySelector("a")?.getAttribute("href"), "/archive?page=3");

    window.history.replaceState({}, "", "/story/43?journey=invalid");
    await render(<StoryReturnLink archiveOnly />, "invalid-legacy-url");
    assert.equal(window.location.search, "");
    assert.equal(document.querySelector("a"), null);
    window.history.replaceState(firstState, "", "/story/43");

    // A remount (as on reload) reads the committed entry, with no pending token.
    await render(<StoryReturnLink archiveOnly />, "reload");
    assert.equal(document.querySelector("a")?.getAttribute("href"), "/archive?page=3");

    window.history.pushState({}, "", "/archive?page=2");
    await render(<BrowseStoryLink id="42">Story</BrowseStoryLink>, "second-list");
    await click();
    await render(<StoryReturnLink archiveOnly />, "second-visit");
    const secondState = window.history.state;
    assert.notEqual(secondState.hacksnapJourney, firstState.hacksnapJourney);
    assert.equal(document.querySelector("a")?.getAttribute("href"), "/archive?page=2");

    // Exercise popstate even when both history entries have the same pathname.
    for (const [state, href] of [
      [firstState, "/archive?page=3"],
      [secondState, "/archive?page=2"],
    ] as const) {
      await act(async () => {
        window.history.replaceState(state, "", "/story/42");
        window.dispatchEvent(new dom.window.PopStateEvent("popstate", { state }));
      });
      assert.equal(document.querySelector("a")?.getAttribute("href"), href);
      assert.equal(window.location.search, "");
    }

    // A direct arrival must not inherit a previous journey from storage.
    window.history.pushState({}, "", "/story/42");
    await render(<StoryReturnLink archiveOnly />, "direct");
    assert.equal(document.querySelector("a"), null);
    await render(<NextStoryLink id="44">Next</NextStoryLink>, "direct-next");
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

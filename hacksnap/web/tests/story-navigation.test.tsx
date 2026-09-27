import assert from "node:assert/strict";
import { test } from "@jest/globals";
import React, { act } from "react";
import { createRequire } from "node:module";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { ListPositionRestorer, StoryReturnLink } from "../app/story-navigation";
import { browseLabel } from "../lib/navigation-context";
const { JSDOM } = createRequire(import.meta.url)("jsdom");

test("archive return preserves route, pagination and scroll without changing breadcrumbs", async () => {
  const token = "11111111-1111-1111-1111-111111111111";
  const dom = new JSDOM('<div id="root"></div>', {
    url: `https://hacksnap.live/story/42?journey=${token}`,
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
      window.history.replaceState({}, "", `/story/42?journey=${token}`);
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
      window.history.replaceState({}, "", `/story/42?journey=${token}`);
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

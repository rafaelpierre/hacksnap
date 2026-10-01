import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/story/1" });
for (const key of [
  "window",
  "document",
  "navigator",
  "Element",
  "Node",
  "HTMLElement",
  "MouseEvent",
]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

jest.unstable_mockModule("next/navigation", () => ({
  usePathname: () => window.location.pathname,
}));
const { ReaderVisit, StoryVisit, Recommendation } = await import("../app/journey-analytics.tsx");
const { readStoryHistory } = await import("../lib/story-history.ts");
const { ShareLinks } = await import("../app/share-links.tsx");

test("production components emit truthful, deduplicated events through a complete controlled journey", async () => {
  const events = [];
  window.gtag = (_command, name, params) => events.push({ name, ...params });
  const observers = [];
  globalThis.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.active = true;
      observers.push(this);
    }
    observe() {}
    disconnect() {
      this.active = false;
    }
  };
  const root = createRoot(document.getElementById("root"));
  const h = React.createElement;
  const count = (name) => events.filter((event) => event.name === name).length;
  const button = (text) =>
    [...document.querySelectorAll("button")].find((el) => el.textContent.trim() === text);
  async function click(el) {
    assert.ok(el);
    await act(async () => el.click());
  }
  async function render(id) {
    await act(async () =>
      root.render(
        h(
          React.StrictMode,
          null,
          h(ReaderVisit),
          h(StoryVisit, { id }),
          h(
            Recommendation,
            { source: id, target: "99", position: 1 },
            h("a", { href: "/story/99", onClick: (event) => event.preventDefault() }, "Next"),
          ),
          h(ShareLinks, {
            id,
            title: "Example",
            takeaway: "A short summary",
            placement: "story_end",
          }),
        ),
      ),
    );
  }
  try {
    await render("1");
    assert.equal(
      !!readStoryHistory().entries["1"]?.openedAt,
      true,
      "valid detail visit records opened",
    );
    await render("1");
    assert.equal(count("reader_visit"), 1);
    assert.equal(count("story_view"), 1);
    window.history.replaceState({}, "", "/story/1?journey=test");
    await render("1");
    assert.equal(count("reader_visit"), 1);
    const observer = observers.findLast((o) => o.active);
    await act(async () => observer.callback([{ isIntersecting: true, intersectionRatio: 0.49 }]));
    assert.equal(count("recommendation_exposure"), 0);
    await act(async () => {
      observer.callback([{ isIntersecting: true, intersectionRatio: 0.5 }]);
      observer.callback([{ isIntersecting: true, intersectionRatio: 1 }]);
    });
    assert.equal(count("recommendation_exposure"), 1);
    await click(document.querySelector("a"));
    await click(document.querySelector("a"));
    assert.equal(count("recommendation_click"), 1);
    await click(button("Share"));
    await click(button("Share"));
    await click(button("Share"));
    assert.equal(count("share_menu_open"), 2);
    assert.equal(count("share_copy_success"), 0);
    let resolveCopy;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          new Promise((resolve) => {
            resolveCopy = resolve;
          }),
      },
    });
    await click(button("Copy link"));
    assert.equal(count("share_copy_attempt"), 1);
    assert.equal(count("share_copy_success"), 0);
    await act(async () => resolveCopy());
    assert.equal(count("share_copy_success"), 1);
    navigator.clipboard.writeText = async () => {
      throw Error("denied");
    };
    await click(button("Copy suggested post"));
    assert.equal(count("share_copy_failure"), 1);
    assert.equal(count("share_manual_fallback"), 1);
    assert.equal(count("share_copy_success"), 1);
    assert.ok(document.querySelector(".share-manual"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await click(button("Copy link"));
    assert.equal(count("share_copy_failure"), 2);
    assert.equal(count("share_copy_success"), 1);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => {} },
    });
    const opened = [];
    window.open = (...args) => opened.push(args);
    await click(document.querySelector('button[aria-label="X (opens in a new tab)"]'));
    assert.equal(count("share_destination_select"), 1);
    const selected = events.find((event) => event.name === "share_destination_select");
    assert.equal(selected.destination, "x");
    assert.equal(selected.placement, "story_end");
    assert.equal(selected.contract_version, 2);
    assert.ok(
      events
        .filter((event) => event.name.startsWith("share_"))
        .every((event) => event.placement === "story_end"),
    );
    assert.equal(opened.length, 1);
    assert.ok(opened[0][0].includes("intent/tweet?text="));
    assert.equal(document.querySelectorAll('a[href*="text="]').length, 0);
    assert.equal(JSON.stringify(events).includes("A short summary"), false);
    window.history.pushState({}, "", "/story/2");
    await render("2");
    window.history.pushState({}, "", "/story/1");
    await render("1");
    assert.equal(count("story_view"), 3);
    assert.equal(count("reader_visit"), 3);
    delete globalThis.IntersectionObserver;
    window.history.pushState({}, "", "/story/3");
    await render("3");
    await act(async () =>
      document
        .querySelector("a")
        .dispatchEvent(new MouseEvent("auxclick", { button: 1, bubbles: true })),
    );
    assert.equal(count("recommendation_exposure"), 2);
    assert.equal(count("recommendation_click"), 2);
    // Failure of the analytics sink must not prevent clipboard or destination behavior.
    window.gtag = () => {
      throw Error("analytics blocked");
    };
    navigator.clipboard.writeText = async () => {};
    await click(button("Copy link"));
    assert.match(document.querySelector(".share-feedback").textContent, /Link copied/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

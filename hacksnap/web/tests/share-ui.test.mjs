import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM('<div id="root"></div><button id="outside">Outside</button>', {
  url: "https://hacksnap.live/",
});
for (const key of [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLTextAreaElement",
  "Event",
  "KeyboardEvent",
]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { ShareLinks } = await import("../app/share-links.tsx");

test("deferred share editor preserves edited Unicode drafts and keyboard, outside, and clipboard behavior", async () => {
  const root = createRoot(document.getElementById("root"));
  const events = [];
  window.gtag = (_command, name, params) => events.push({ name, ...params });
  const trigger = () => document.querySelector(".share-trigger");
  const button = (text) =>
    [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === text);
  const click = async (element) => {
    assert.ok(element);
    await act(async () => element.click());
  };
  try {
    await act(async () =>
      root.render(
        React.createElement(ShareLinks, {
          id: "123",
          title: "A story",
          takeaway: "A summary",
          placement: "feed",
        }),
      ),
    );
    assert.equal(document.querySelector(".share-panel"), null);
    await act(async () => trigger().focus());
    await click(trigger());
    assert.equal(trigger().getAttribute("aria-expanded"), "true");
    assert.equal(document.activeElement, button("Copy link"));
    const draft = document.querySelector(".share-draft");
    assert.ok(draft);
    const edited = `${"😀".repeat(140)} https://hacksnap.live/story/123`;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      setter.call(draft, edited);
      draft.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(draft.value, edited);
    assert.match(document.querySelector(".share-count").textContent, /304\/280 on X/);
    assert.ok(button("X (edit first)"));
    await act(async () => draft.focus());
    await act(async () =>
      draft.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    assert.equal(document.querySelector(".share-panel"), null);
    assert.equal(document.activeElement, trigger());
    await click(trigger());
    assert.equal(document.querySelector(".share-draft").value, edited);
    assert.equal(document.activeElement, button("Copy link"));

    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await click(button("Copy suggested post"));
    assert.equal(document.querySelector(".share-manual").value, edited);
    assert.equal(document.activeElement, document.querySelector(".share-manual"));
    assert.equal(document.querySelector(".share-manual").selectionStart, 0);
    assert.equal(document.querySelector(".share-manual").selectionEnd, edited.length);

    const opened = [];
    window.open = (...args) => opened.push(args);
    await click(document.querySelector('button[aria-label="LinkedIn (opens in a new tab)"]'));
    assert.equal(new URL(opened[0][0]).searchParams.get("url"), "https://hacksnap.live/story/123");
    await act(async () => document.getElementById("outside").focus());
    assert.equal(document.querySelector(".share-panel"), null);
    await act(async () =>
      document.getElementById("outside").dispatchEvent(new Event("pointerdown", { bubbles: true })),
    );
    assert.equal(document.querySelector(".share-panel"), null);
    assert.equal(document.activeElement, document.getElementById("outside"));
    assert.deepEqual(
      events.filter((event) => event.name === "share_menu_open").map((event) => event.placement),
      ["feed", "feed"],
    );
    assert.equal(JSON.stringify(events).includes(edited), false);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/" });
for (const key of ["window", "document", "navigator", "Node", "HTMLElement"]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let loadCount = 0;
let resolveRetry;
jest.unstable_mockModule("../app/share-editor-loader.ts", () => ({
  loadShareEditor: () => {
    loadCount += 1;
    if (loadCount === 1) return Promise.reject(new Error("chunk unavailable"));
    return new Promise((resolve) => {
      resolveRetry = () =>
        resolve({
          ShareEditor: ({ firstActionRef }) =>
            React.createElement("button", { ref: firstActionRef }, "Copy link"),
        });
    });
  },
}));
const { createRoot } = await import("react-dom/client");
const { ShareLinks } = await import("../app/share-links.tsx");

test("failed editor loading keeps fallback actions and retry does not steal manual-copy focus", async () => {
  const root = createRoot(document.getElementById("root"));
  const button = (text) =>
    [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === text);
  const click = async (element) => {
    assert.ok(element);
    await act(async () => element.click());
  };
  try {
    await act(async () =>
      root.render(React.createElement(ShareLinks, { id: "7", title: "Seven" })),
    );
    await click(button("Share"));
    assert.match(document.querySelector(".share-load-status").textContent, /couldn’t load/);
    assert.ok(button("Copy link"));
    assert.ok(button("LinkedIn"));
    assert.ok(button("Email"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await click(button("LinkedIn"));
    assert.match(
      document.querySelector(".share-manual").value,
      /https:\/\/hacksnap.live\/story\/7$/,
    );
    assert.ok(button("Open LinkedIn"));
    await click(button("Retry editor"));
    assert.equal(loadCount, 2);
    await click(button("Copy suggested post"));
    const manual = document.querySelector(".share-manual");
    assert.equal(document.activeElement, manual);
    await act(async () => {
      resolveRetry();
      await Promise.resolve();
    });
    assert.equal(document.activeElement, manual);
    assert.equal(manual.selectionEnd, manual.value.length);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

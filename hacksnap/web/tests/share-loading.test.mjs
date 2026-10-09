import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/" });
for (const key of ["window", "document", "navigator", "Node", "HTMLElement"]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let resolveEditor;
jest.unstable_mockModule(
  "../app/share-editor.tsx",
  () =>
    new Promise((resolve) => {
      resolveEditor = () =>
        resolve({
          ShareEditor: ({ firstActionRef }) =>
            React.createElement("button", { type: "button", ref: firstActionRef }, "Copy link"),
        });
    }),
);
const { createRoot } = await import("react-dom/client");
const { ShareLinks } = await import("../app/share-links.tsx");

test("loading controls work, closed panels stay closed, and editor resolution keeps manual-copy focus", async () => {
  const root = createRoot(document.getElementById("root"));
  const menu = (index) => document.querySelectorAll(".share-menu")[index];
  const click = async (element) => {
    assert.ok(element);
    await act(async () => element.click());
  };
  try {
    await act(async () =>
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(ShareLinks, { id: "1", title: "First" }),
          React.createElement(ShareLinks, { id: "2", title: "Second" }),
        ),
      ),
    );
    await click(menu(0).querySelector(".share-trigger"));
    assert.match(menu(0).querySelector(".share-load-status").textContent, /Loading post editor/);
    assert.ok(menu(0).querySelector('button[aria-label="LinkedIn (copy post first)"]'));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await click(menu(0).querySelector('button[aria-label="LinkedIn (copy post first)"]'));
    assert.match(
      menu(0).querySelector(".share-manual").value,
      /https:\/\/hacksnap.live\/story\/1$/,
    );
    assert.ok(menu(0).querySelector('a[aria-label="Open LinkedIn (opens in a new tab)"]'));
    await click(menu(0).querySelector(".share-close"));
    assert.equal(menu(0).querySelector(".share-panel"), null);

    await click(menu(1).querySelector(".share-trigger"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await click(
      [...menu(1).querySelectorAll("button")].find(
        (button) => button.textContent.trim() === "Copy suggested post",
      ),
    );
    const manual = menu(1).querySelector(".share-manual");
    assert.ok(manual);
    assert.equal(document.activeElement, manual);
    assert.equal(manual.selectionEnd, manual.value.length);
    await act(async () => {
      resolveEditor();
      await Promise.resolve();
    });
    assert.equal(menu(0).querySelector(".share-panel"), null);
    assert.equal(document.activeElement, manual);
    assert.equal(manual.selectionEnd, manual.value.length);
    await click(menu(0).querySelector(".share-trigger"));
    assert.ok(menu(0).querySelector(".share-panel"));
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

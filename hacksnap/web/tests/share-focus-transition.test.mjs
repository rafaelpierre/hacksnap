import assert from "node:assert/strict";
import { afterAll, jest, test } from "@jest/globals";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/" });
const keys = ["window", "document", "navigator", "Node", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"];
const previous = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
for (const key of keys) {
  const value = key === "IS_REACT_ACT_ENVIRONMENT" ? true : dom.window[key];
  Object.defineProperty(globalThis, key, { value, configurable: true });
}
afterAll(() => {
  dom.window.close();
  keys.forEach((key, index) => {
    if (previous[index]) Object.defineProperty(globalThis, key, previous[index]);
    else Reflect.deleteProperty(globalThis, key);
  });
});
let resolveEditor;
jest.unstable_mockModule("../app/share-editor-loader.ts", () => ({
  loadShareEditor: () =>
    new Promise((resolve) => {
      resolveEditor = resolve;
    }),
}));
const { createRoot } = await import("react-dom/client");
const { SharePanel } = await import("../app/share-panel.tsx");
const editor = await import("../app/share-editor.tsx");

for (const destination of ["Copy suggested post", "Email", "Close share dialog"]) {
  test(`editor replacement preserves ${destination} focus moved after import resolution`, async () => {
    const root = createRoot(document.getElementById("root"));
    const button = (label) =>
      [...document.querySelectorAll("button")].find(
        (node) => node.getAttribute("aria-label") === label || node.textContent.trim() === label,
      );
    try {
      await act(async () =>
        root.render(
          React.createElement(SharePanel, {
            id: "123",
            title: "Story",
            open: true,
            onClose() {},
            panelId: "share",
          }),
        ),
      );
      assert.equal(document.activeElement, button("Copy link"));
      await act(async () => {
        resolveEditor(editor);
        // Let the import callback schedule its render, then move focus before commit.
        await Promise.resolve();
        if (destination === "Copy suggested post") {
          const close = button("Close share dialog");
          close.focus();
          close.dispatchEvent(
            new dom.window.KeyboardEvent("keydown", {
              key: "Tab",
              shiftKey: true,
              bubbles: true,
              cancelable: true,
            }),
          );
          assert.ok(document.activeElement === button(destination));
        } else {
          button(destination).focus();
        }
      });
      assert.ok(document.querySelector(".share-draft"));
      assert.ok(document.activeElement === button(destination), `Expected focus on ${destination}`);
    } finally {
      await act(async () => root.unmount());
    }
  });
}

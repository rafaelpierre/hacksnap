import assert from "node:assert/strict";
import { test } from "@jest/globals";
import React, { act } from "react";
import { createRequire } from "node:module";
import { StickyHeader } from "../app/sticky-header";
const { JSDOM } = createRequire(import.meta.url)("jsdom");

test("header measurements follow wrapping and release observers on unmount", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  let resize: (() => void) | undefined;
  let disconnected = false;
  let height = 76;
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
  };
  const previous = Object.keys(values).map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  Object.entries(values).forEach(([key, value]) =>
    Object.defineProperty(globalThis, key, { configurable: true, value }),
  );
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => ({ height });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () =>
      root.render(
        <StickyHeader>
          <a href="/">Home</a>
        </StickyHeader>,
      ),
    );
    assert.equal(document.documentElement.style.getPropertyValue("--site-header-height"), "76px");
    height = 212;
    resize!();
    assert.equal(document.documentElement.style.getPropertyValue("--site-header-height"), "212px");
    await act(async () => root.unmount());
    assert.equal(disconnected, true);
    assert.equal(document.documentElement.style.getPropertyValue("--site-header-height"), "");
  } finally {
    dom.window.close();
    Object.keys(values).forEach((key, i) => {
      if (previous[i]) Object.defineProperty(globalThis, key, previous[i]!);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
});

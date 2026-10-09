import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/" });
for (const key of ["window", "document", "navigator", "Node", "HTMLElement"]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const requests = [];
jest.unstable_mockModule("../app/share-panel-loader.ts", () => ({
  loadSharePanel: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
}));
const { createRoot } = await import("react-dom/client");
const { renderToString } = await import("react-dom/server");
const { ShareLinks } = await import("../app/share-links.tsx");
const click = async (element) => {
  assert.ok(element);
  await act(async () => element.click());
};
const trigger = () => document.querySelector(".share-trigger");
const button = (label) =>
  [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === label);
const resolvePanel = async (request) => {
  await act(async () => request.resolve(await import("../app/share-panel.tsx")));
};

test("SSR and unopened feeds do not request sharing code; closing a pending request keeps it closed", async () => {
  const props = { id: "123", title: "First story", takeaway: "First takeaway" };
  assert.match(renderToString(React.createElement(ShareLinks, props)), /Share: First story/);
  assert.equal(requests.length, 0);
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement(ShareLinks, props)));
    assert.equal(requests.length, 0);
    trigger().focus();
    await click(trigger());
    assert.equal(requests.length, 1);
    assert.match(document.querySelector('[role="status"]').textContent, /Loading sharing/);
    assert.equal(document.activeElement, trigger());
    await click(trigger());
    await resolvePanel(requests[0]);
    assert.equal(document.querySelector(".share-panel"), null);
    assert.equal(trigger().getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, trigger());
    await click(trigger());
    assert.equal(requests.length, 1);
    assert.ok(document.querySelector("dialog.share-panel[open]"));
    assert.equal(document.activeElement, button("Copy link"));
  } finally {
    await act(async () => root.unmount());
  }
});

test("a failed dialog request can retry, dismiss with Escape, and use refreshed props when it opens", async () => {
  const root = createRoot(document.getElementById("root"));
  const start = requests.length;
  try {
    await act(async () =>
      root.render(React.createElement(ShareLinks, { id: "456", title: "Old title" })),
    );
    await click(trigger());
    await act(async () => requests[start].reject(new Error("chunk unavailable")));
    assert.match(document.querySelector('[role="status"]').textContent, /couldn’t load/);
    button("Retry sharing").focus();
    await click(button("Retry sharing"));
    assert.equal(document.activeElement, trigger());
    assert.equal(requests.length, start + 2);
    await act(async () =>
      document.activeElement.dispatchEvent(
        new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    assert.equal(trigger().getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, trigger());
    await click(trigger());
    assert.equal(requests.length, start + 2, "reopening shares the pending request");
    await act(async () =>
      root.render(
        React.createElement(ShareLinks, {
          id: "456",
          title: "Updated title",
          takeaway: "Ready takeaway",
        }),
      ),
    );
    await resolvePanel(requests[start + 1]);
    assert.equal(
      document.querySelector(".share-draft").value,
      "Updated title\n\nReady takeaway\n\nhttps://hacksnap.live/story/456",
    );
    assert.equal(document.activeElement, button("Copy link"));
    await click(document.querySelector(".share-close"));
    assert.equal(document.activeElement, trigger());
  } finally {
    await act(async () => root.unmount());
  }
});

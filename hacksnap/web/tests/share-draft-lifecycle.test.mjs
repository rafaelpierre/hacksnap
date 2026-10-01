import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/" });
for (const key of [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLTextAreaElement",
  "Event",
]) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const { ShareLinks } = await import("../app/share-links.tsx");

test("share draft refresh, reset, identity changes, and delayed copies follow the current lifecycle", async () => {
  const root = createRoot(document.getElementById("root"));
  const writes = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text) => new Promise((resolve, reject) => writes.push({ text, resolve, reject })),
    },
  });
  const props = {
    id: "123",
    slug: "first-title-123",
    title: "First title",
    takeaway: "First takeaway",
  };
  const button = (label) =>
    [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === label);
  const click = async (element) => {
    assert.ok(element);
    await act(async () => element.click());
  };
  const settle = async (promiseAction) => {
    await act(async () => {
      promiseAction();
      await Promise.resolve();
      await Promise.resolve();
    });
  };
  const render = async (nextProps) =>
    act(async () => root.render(React.createElement(ShareLinks, nextProps)));

  try {
    await render(props);
    await click(button("Share"));
    let draft = document.querySelector(".share-draft");
    assert.equal(
      draft.value,
      "First title\n\nFirst takeaway\n\nhttps://hacksnap.live/story/first-title-123",
    );
    await click(button("Copy suggested post"));
    assert.equal(writes.length, 1);

    const refreshed = { ...props, title: "Updated title", takeaway: "Updated takeaway" };
    await render(refreshed);
    draft = document.querySelector(".share-draft");
    assert.equal(
      draft.value,
      "Updated title\n\nUpdated takeaway\n\nhttps://hacksnap.live/story/first-title-123",
    );
    await settle(() => writes[0].resolve());
    assert.equal(document.querySelector(".share-feedback").textContent, "");

    const edit = async (value) =>
      act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        setter.call(document.querySelector(".share-draft"), value);
        document.querySelector(".share-draft").dispatchEvent(new Event("input", { bubbles: true }));
      });
    const edited = "My careful edit";
    await edit(edited);
    await render({ ...refreshed, title: "Latest title", takeaway: "Latest takeaway" });
    assert.equal(document.querySelector(".share-draft").value, edited);
    assert.ok(button("Reset draft"));

    await click(button("Share"));
    assert.equal(document.querySelector(".share-panel"), null);
    await click(button("Share"));
    assert.equal(document.querySelector(".share-draft").value, edited);
    await click(button("Reset draft"));
    assert.equal(
      document.querySelector(".share-draft").value,
      "Latest title\n\nLatest takeaway\n\nhttps://hacksnap.live/story/first-title-123",
    );
    assert.equal(button("Reset draft"), undefined);
    assert.equal(document.activeElement, document.querySelector(".share-draft"));

    await edit("Draft before slow successful copy");
    await click(button("Copy suggested post"));
    assert.equal(writes.length, 2);
    await edit("Replacement draft after copy started");
    await settle(() => writes[1].resolve());
    assert.equal(document.querySelector(".share-feedback").textContent, "");
    assert.equal(document.querySelector(".share-manual"), null);

    await click(button("Copy suggested post"));
    assert.equal(writes.length, 3);
    await edit("Replacement draft after failed copy started");
    await settle(() => writes[2].reject(new Error("clipboard unavailable")));
    assert.equal(document.querySelector(".share-feedback").textContent, "");
    assert.equal(document.querySelector(".share-manual"), null);

    await click(button("Copy link"));
    assert.equal(writes.length, 4);
    await render({
      id: "456",
      slug: "new-story-456",
      title: "New story",
      takeaway: "New takeaway",
    });
    assert.equal(
      document.querySelector(".share-draft").value,
      "New story\n\nNew takeaway\n\nhttps://hacksnap.live/story/new-story-456",
    );
    assert.equal(document.querySelector(".share-feedback").textContent, "");
    await settle(() => writes[3].resolve());
    assert.equal(document.querySelector(".share-feedback").textContent, "");
    assert.equal(document.querySelector(".share-manual"), null);

    await click(button("Copy link"));
    assert.equal(writes.length, 5);
    await render({
      id: "789",
      slug: "third-story-789",
      title: "Third story",
      takeaway: "Third takeaway",
    });
    await settle(() => writes[4].reject(new Error("clipboard unavailable")));
    assert.equal(document.querySelector(".share-feedback").textContent, "");
    assert.equal(document.querySelector(".share-manual"), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

test("an unopened share draft uses refreshed ready content on its first open", async () => {
  const root = createRoot(document.getElementById("root"));
  const button = (label) =>
    [...document.querySelectorAll("button")].find((item) => item.textContent.trim() === label);
  try {
    await act(async () =>
      root.render(
        React.createElement(ShareLinks, {
          id: "321",
          slug: "ready-story-321",
          title: "Ready story",
          takeaway: null,
        }),
      ),
    );
    assert.equal(document.querySelector(".share-panel"), null);

    await act(async () =>
      root.render(
        React.createElement(ShareLinks, {
          id: "321",
          slug: "ready-story-321",
          title: "Ready story",
          takeaway: "Summary arrived before first open",
        }),
      ),
    );
    assert.equal(document.querySelector(".share-panel"), null);

    await act(async () => button("Share").click());
    assert.equal(
      document.querySelector(".share-draft").value,
      "Ready story\n\nSummary arrived before first open\n\nhttps://hacksnap.live/story/ready-story-321",
    );
  } finally {
    await act(async () => root.unmount());
  }
});

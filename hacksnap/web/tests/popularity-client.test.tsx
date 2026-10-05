import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import { createRequire } from "node:module";
import React, { act } from "react";
import { createJourney } from "../lib/analytics";
import { sendStoryEvent } from "../lib/popularity-transport";

const { JSDOM } = createRequire(import.meta.url)("jsdom");

test("first-party collection reuses route IDs and is independent of throwing GA", () => {
  const sent: Array<{ name: string; visit_id: string | number }> = [];
  let id = 0;
  const journey = createJourney(
    () => {
      throw Error("GA blocked");
    },
    () => `visit-${++id}`,
    (name, params) => {
      if (name === "story_view") sent.push({ name, visit_id: params.visit_id });
    },
  );
  for (const path of ["/story/1", "/story/1", "/", "/story/1"]) {
    journey.route(path);
    if (path.startsWith("/story/")) journey.emit("story_view", { story_id: "1" }, "story:1");
  }
  assert.deepEqual(
    sent.map(({ visit_id }) => visit_id),
    ["visit-1", "visit-3"],
  );
});

test("transport sends only the public event payload and tolerates absent or failed browser fetch", async () => {
  const previous = globalThis.window;
  const requests: Array<{ url: unknown; options: RequestInit }> = [];
  const event = {
    kind: "view" as const,
    story_id: "42",
    visit_id: "ff74b39e-0423-4cf0-bce2-7f36c1cb63b7",
  };
  try {
    globalThis.window = {} as Window & typeof globalThis;
    assert.doesNotThrow(() => sendStoryEvent(event));
    window.fetch = (async (url, options) => {
      requests.push({ url, options: options! });
      throw Error("offline");
    }) as typeof fetch;
    sendStoryEvent(event);
    await Promise.resolve();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/api/story-events");
    assert.deepEqual(JSON.parse(requests[0].options.body as string), event);
    assert.equal(requests[0].options.keepalive, true);
    assert.equal(requests[0].options.credentials, "same-origin");
    window.fetch = () => {
      throw Error("blocked");
    };
    assert.doesNotThrow(() => sendStoryEvent(event));
  } finally {
    if (previous === undefined) delete (globalThis as { window?: Window }).window;
    else globalThis.window = previous;
  }
});

jest.unstable_mockModule("next/navigation", () => ({
  usePathname: () => window.location.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

test("reader captures canonical story activations without changing navigation or counting non-story links", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/" });
  for (const key of [
    "window",
    "document",
    "navigator",
    "Element",
    "Node",
    "HTMLElement",
    "MouseEvent",
  ])
    Object.defineProperty(globalThis, key, {
      value: dom.window[key as keyof typeof dom.window],
      configurable: true,
    });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const sent: Array<{ kind: string; story_id: string; visit_id: string }> = [];
  window.fetch = (async (_url, options) => {
    sent.push(JSON.parse(options!.body as string));
    return new Response(null, { status: 202 });
  }) as typeof fetch;
  (window as Window & { gtag?: () => void }).gtag = () => {
    throw Error("GA blocked");
  };
  const { ReaderVisit, StoryVisit } = await import("../app/journey-analytics");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  const hrefs = [
    "/story/headline-42",
    "/story/43",
    "/story/44",
    "/story/45",
    "/archive",
    "https://other.test/story/46",
    "/story/invalid",
    "/story/47/extra",
  ];
  async function render(story?: string) {
    await act(async () =>
      root.render(
        <React.StrictMode>
          <ReaderVisit />
          {story && <StoryVisit id={story} />}
          {hrefs.map((href) => (
            <a key={href} href={href} onClick={(event) => event.preventDefault()}>
              <span>{href}</span>
            </a>
          ))}
        </React.StrictMode>,
      ),
    );
  }
  async function activate(index: number, type = "click", options: MouseEventInit = {}) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...options });
    await act(async () =>
      document.querySelectorAll("a")[index].querySelector("span")!.dispatchEvent(event),
    );
    return event;
  }
  try {
    await render();
    await activate(0); // Primary click (also how keyboard activation is dispatched).
    await activate(0);
    await activate(1, "click", { ctrlKey: true });
    await activate(2, "auxclick", { button: 1 });
    await activate(3, "auxclick", { button: 2 });
    for (const index of [4, 5, 6, 7]) await activate(index);
    assert.deepEqual(
      sent.map(({ kind, story_id }) => [kind, story_id]),
      [
        ["click", "42"],
        ["click", "43"],
        ["click", "44"],
      ],
    );
    assert.equal(new Set(sent.map(({ visit_id }) => visit_id)).size, 1);
    window.history.pushState({}, "", "/story/42");
    await render("42");
    await render("42");
    window.history.replaceState({}, "", "/story/42?query=change");
    await render("42");
    assert.equal(sent.filter(({ kind }) => kind === "view").length, 1);
    window.history.pushState({}, "", "/");
    await render();
    await activate(0);
    window.history.pushState({}, "", "/story/42");
    await render("42");
    assert.equal(sent.filter(({ kind }) => kind === "view").length, 2);
    assert.equal(
      sent.filter(({ kind, story_id }) => kind === "click" && story_id === "42").length,
      2,
    );
    assert.equal(
      new Set(sent.filter(({ kind }) => kind === "view").map(({ visit_id }) => visit_id)).size,
      2,
    );
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});

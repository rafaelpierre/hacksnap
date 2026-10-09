import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { jest, test } from "@jest/globals";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
let pathname = "/";
let search = new URLSearchParams();

jest.unstable_mockModule("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => search,
}));
jest.unstable_mockModule("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement("a", props, children),
  useLinkStatus: () => ({ pending: false }),
}));

const { MobileNavigation } = await import("../app/main-navigation");
const { BrowseLayout } = await import("../app/topic-sidebar");

test("mobile navigation renders a native disclosure and ordinary links before hydration", () => {
  const html = renderToStaticMarkup(<MobileNavigation />);
  assert.match(html, /<details class="mobile-navigation">/);
  assert.match(html, /<summary[^>]*aria-controls="mobile-navigation-panel"/);
  // Native summary exposes the open state without a stale JavaScript-only aria value.
  assert.doesNotMatch(html, /aria-expanded/);
  assert.match(html, /aria-label="Topics"/);
  assert.doesNotMatch(html, /<span>Topics<\/span>/);
  assert.doesNotMatch(html, /href="\/about"|href="\/"/);
  assert.match(html, /href="\/\?category=agents-coding"/);
});

test("route content does not duplicate the shared navigation or sidebar", () => {
  const html = renderToStaticMarkup(<BrowseLayout>Feed</BrowseLayout>);
  assert.match(html, /Feed/);
  assert.doesNotMatch(html, /<main|<nav|<aside|topic-sidebar|browse-right-sidebar/);
});

test("mobile disclosure closes on Escape, selection, and browser route changes", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://hacksnap.live/" });
  const values = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.keys(values).map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  Object.entries(values).forEach(([key, value]) =>
    Object.defineProperty(globalThis, key, { configurable: true, value }),
  );
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root")!);
  pathname = "/";
  search = new URLSearchParams();
  try {
    await act(async () => root.render(<MobileNavigation />));
    const details = document.querySelector("details")!;
    const summary = document.querySelector("summary")!;
    assert.equal(summary.getAttribute("aria-expanded"), "false");
    const link = document.querySelector<HTMLAnchorElement>('a[href="/topics"]')!;
    const open = async () => {
      await act(async () => {
        details.open = true;
        details.dispatchEvent(new dom.window.Event("toggle", { bubbles: false }));
      });
      assert.equal(summary.getAttribute("aria-expanded"), "true");
    };
    await open();
    link.focus();
    await act(async () => {
      link.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    assert.equal(details.open, false);
    assert.equal(document.activeElement, summary);
    assert.equal(summary.getAttribute("aria-expanded"), "false");

    await open();
    await act(async () => {
      const event = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
      event.preventDefault();
      link.dispatchEvent(event);
    });
    assert.equal(details.open, false);
    assert.equal(document.activeElement, summary);

    await open();
    search = new URLSearchParams("category=agents-coding");
    await act(async () => root.render(<MobileNavigation />));
    assert.equal(details.open, false);

    await open();
    pathname = "/topics";
    await act(async () => root.render(<MobileNavigation />));
    assert.equal(details.open, false);
    assert.equal(document.querySelector('a[href="/topics"]')?.getAttribute("aria-current"), "page");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.keys(values).forEach((key, index) => {
      if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!);
      else Reflect.deleteProperty(globalThis, key);
    });
    pathname = "/";
    search = new URLSearchParams();
  }
});

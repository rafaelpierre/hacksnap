import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { jest, test } from "@jest/globals";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

const { JSDOM } = createRequire(import.meta.url)("jsdom");
let pending = false;
let pathname = "/";
let search = new URLSearchParams();

jest.unstable_mockModule("../app/navigation-pending-link.module.css", () => ({
  default: { announcement: "announcement", hint: "hint", link: "link" },
}));
jest.unstable_mockModule("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    createElement("a", props, children),
  useLinkStatus: () => ({ pending }),
}));
jest.unstable_mockModule("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => search,
}));

const { NavigationPendingLink } = await import("../app/navigation-pending-link.tsx");
const { MainNavigation } = await import("../app/main-navigation.tsx");
const { TopicSidebar } = await import("../app/topic-sidebar.tsx");

test("navigation pending link stays an ordinary link until its transition is pending", () => {
  pending = false;
  const idle = renderToStaticMarkup(
    <NavigationPendingLink href="/?category=agents-coding" pendingLabel="Loading Agents & Coding…">
      Agents &amp; Coding
    </NavigationPendingLink>,
  );
  assert.match(idle, /^<a href="\/\?category=agents-coding"[^>]*>/);
  assert.doesNotMatch(idle, /Loading Agents/);
  assert.doesNotMatch(idle, /role="status"/);
  assert.match(idle, /aria-hidden="true"/);

  pending = true;
  const loading = renderToStaticMarkup(
    <NavigationPendingLink href="/?category=agents-coding" pendingLabel="Loading Agents & Coding…">
      Agents &amp; Coding
    </NavigationPendingLink>,
  );
  assert.match(loading, /data-pending="true"/);
  assert.match(loading, /role="status"/);
  assert.match(loading, /Loading Agents &amp; Coding…/);
});

test("navigation keeps its real destinations and current-route semantics", () => {
  pending = false;
  pathname = "/2026/10";
  const header = renderToStaticMarkup(<MainNavigation />);
  assert.doesNotMatch(header, /href="\/archive"|Top stories/);
  assert.match(header, /href="\/"[^>]*aria-current="location"/);
  assert.doesNotMatch(header, /href="\/topics"|href="\/\?category=/);
  assert.match(header, /href="\/about"/);

  const sidebar = renderToStaticMarkup(<TopicSidebar active="agents_coding" />);
  assert.match(sidebar, /href="\/topics"/);
  assert.doesNotMatch(sidebar, /href="\/"|href="\/about"/);
  assert.match(sidebar, /href="\/\?category=agents-coding"[^>]*aria-current="page"/);
});

test("Latest is the root destination and selects the homepage", () => {
  pending = false;
  pathname = "/";
  const header = renderToStaticMarkup(<MainNavigation />);
  assert.match(header, /href="\/"[^>]*aria-current="page"[^>]*>Latest/);
  assert.doesNotMatch(header, /href="\/archive"/);

  pathname = "/about";
  const about = renderToStaticMarkup(<MainNavigation />);
  assert.doesNotMatch(about, /href="\/"[^>]*aria-current/);
  assert.match(about, /href="\/about"[^>]*aria-current="page"/);
});

test("query topic destinations select the topic and clear Latest without replacing links", async () => {
  const dom = new JSDOM("<body></body>", { url: "https://hacksnap.live/" });
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
  pathname = "/";
  search = new URLSearchParams("category=agents-coding&page=2");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = () =>
    root.render(
      <>
        <MainNavigation />
        <TopicSidebar />
      </>,
    );
  try {
    await act(render);
    const latest = container.querySelector('a[href="/"]')!;
    const topic = container.querySelector<HTMLAnchorElement>('a[href="/?category=agents-coding"]')!;
    assert.equal(latest.hasAttribute("aria-current"), false);
    assert.equal(topic.getAttribute("aria-current"), "page");
    assert.equal(container.querySelectorAll('[aria-current="page"]').length, 1);
    topic.focus();
    search = new URLSearchParams();
    await act(render);
    assert.equal(latest.getAttribute("aria-current"), "page");
    assert.equal(topic.hasAttribute("aria-current"), false);
    assert.equal(document.activeElement, topic);
    assert.equal(container.querySelector('a[href="/?category=agents-coding"]'), topic);
  } finally {
    await act(() => root.unmount());
    container.remove();
    dom.window.close();
    Object.keys(values).forEach((key, index) => {
      if (previous[index]) Object.defineProperty(globalThis, key, previous[index]!);
      else Reflect.deleteProperty(globalThis, key);
    });
    search = new URLSearchParams();
  }
});

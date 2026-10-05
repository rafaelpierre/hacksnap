import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let pending = false;
let pathname = "/";

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
}));

const { NavigationPendingLink } = await import("../app/navigation-pending-link.tsx");
const { MainNavigation } = await import("../app/main-navigation.tsx");
const { TopicSidebar } = await import("../app/topic-sidebar.tsx");

test("navigation pending link stays an ordinary link until its transition is pending", () => {
  pending = false;
  const idle = renderToStaticMarkup(
    <NavigationPendingLink href="/category/agents-coding" pendingLabel="Loading Agents & Coding…">
      Agents &amp; Coding
    </NavigationPendingLink>,
  );
  assert.match(idle, /^<a href="\/category\/agents-coding"[^>]*>/);
  assert.doesNotMatch(idle, /Loading Agents/);
  assert.doesNotMatch(idle, /role="status"/);
  assert.match(idle, /aria-hidden="true"/);

  pending = true;
  const loading = renderToStaticMarkup(
    <NavigationPendingLink href="/category/agents-coding" pendingLabel="Loading Agents & Coding…">
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
  assert.match(header, /href="\/topics"/);
  assert.match(header, /href="\/about"/);

  const sidebar = renderToStaticMarkup(<TopicSidebar active="agents_coding" />);
  assert.match(sidebar, /href="\/topics"/);
  assert.match(sidebar, /href="\/category\/agents-coding"[^>]*aria-current="page"/);
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
});

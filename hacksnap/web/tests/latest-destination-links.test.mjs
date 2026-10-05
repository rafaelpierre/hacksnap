import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import { cloneElement, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

jest.unstable_mockModule("server-only", () => ({}));
jest.unstable_mockModule("next/cache", () => ({ unstable_noStore: () => {} }));
jest.unstable_mockModule("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => "/category/agents-coding",
  notFound: () => {
    throw new Error("Unexpected missing category");
  },
}));
jest.unstable_mockModule("next/link", () => ({
  default: ({ href, children, ...props }) => createElement("a", { href, ...props }, children),
}));
jest.unstable_mockModule("../lib/browse-streaming.ts", () => ({
  shouldStreamBrowse: async () => false,
}));
jest.unstable_mockModule("../lib/data.ts", () => ({
  getCategoryStories: async () => ({ stories: [], hasNext: false }),
  getCategoryCounts: async () => ({}),
}));
jest.unstable_mockModule("../app/story-feed.tsx", () => ({
  StoryFeed: ({ initialStories, emptyState }) => (initialStories.length ? null : emptyState),
}));
jest.unstable_mockModule("../app/topic-sidebar.tsx", () => ({
  BrowseLayout: ({ children }) => createElement("main", null, children),
}));

const { default: CategoryPage } = await import("../app/category/[slug]/page.tsx");
const { default: ApiDocs } = await import("../app/docs/api/page.tsx");

test("an empty topic links its breadcrumb and browse action directly to Latest", async () => {
  const shell = await CategoryPage({
    params: Promise.resolve({ slug: "agents-coding" }),
    searchParams: Promise.resolve({}),
  });
  // Optional topic counts stream independently; isolate the page links from that read.
  const html = renderToStaticMarkup(
    cloneElement(shell, { count: createElement("span", null, "0") }),
  );
  assert.match(html, /href="\/">hacksnap<\/a>/);
  assert.match(html, /No stories in this topic yet/);
  assert.match(html, /href="\/"[^>]*>Browse latest stories/);
  assert.match(html, /href="\/topics">topics<\/a>/);
  assert.doesNotMatch(html, /href="\/archive"|Browse top stories/);
});

test("API docs return directly to Latest while describing the separate ranked API", () => {
  const html = renderToStaticMarkup(createElement(ApiDocs));
  assert.match(html, /<a(?=[^>]*class="back-link")(?=[^>]*href="\/")[^>]*>/);
  assert.match(html, /Latest stories<\/a>/);
  assert.match(html, /Stories follow Hacksnap ranking/);
  assert.doesNotMatch(html, /href="\/archive"|homepage ranking/);
});

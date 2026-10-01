import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import React from "react";
import type { Story } from "../lib/data.ts";

const events: string[] = [];
let archiveMonths: { month: string }[] = [{ month: "2026-09" }];
let archiveResult: { stories: Story[]; hasNext: boolean } = {
  stories: [],
  hasNext: false,
};
let monthsFailure: Error | null = null;
let archiveFailure: Error | null = null;
let streamBrowse = true;
const routeSignal = new Error("not found");

function story(hn_id: string): Story {
  return {
    hn_id,
    title: `Story ${hn_id}`,
    category: null,
    url: "https://example.com/story",
    points: 1,
    comment_count: 0,
    date_added: new Date("2026-09-01T00:00:00.000Z"),
    summary: null,
  };
}

jest.unstable_mockModule("../lib/data.ts", () => ({
  getArchiveMonths: async () => {
    events.push("months");
    if (monthsFailure) throw monthsFailure;
    return archiveMonths;
  },
  getArchiveStories: async (month: string | null, page: number) => {
    events.push(`stories:${month ?? "latest"}:${page}`);
    if (archiveFailure) throw archiveFailure;
    return archiveResult;
  },
}));
jest.unstable_mockModule("next/navigation", () => ({
  usePathname: () => "/archive",
  useRouter: () => ({ refresh: () => {} }),
  notFound: () => {
    throw routeSignal;
  },
}));
jest.unstable_mockModule("../lib/browse-streaming.ts", () => ({
  shouldStreamBrowse: async () => streamBrowse,
}));
jest.unstable_mockModule("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href }, children),
}));
type MockStoryFeedProps = { initialStories: unknown[] } & Record<string, unknown>;

function MockStoryFeed(props: MockStoryFeedProps) {
  return React.createElement("div", { "data-story-feed": true, ...props }, "feed");
}
jest.unstable_mockModule("../app/story-feed.tsx", () => ({ StoryFeed: MockStoryFeed }));
jest.unstable_mockModule("../app/browse-loading.tsx", () => ({
  BrowseLoading: () => React.createElement("div", null, "loading"),
}));
jest.unstable_mockModule("../lib/stories-api.ts", () => ({
  publicFeedStory: (story: unknown) => story,
}));
jest.unstable_mockModule("../app/topic-sidebar.tsx", () => ({
  BrowseLayout: ({ children }: { children: React.ReactNode }) =>
    React.createElement("main", null, children),
}));

const { default: ArchivePage, generateMetadata } =
  await import("../app/archive/[[...date]]/page.tsx");
const { ArchiveStoryList } = await import("../app/archive-story-list.tsx");
const { DataUnavailableError } = await import("../lib/data-availability.ts");

function props(date?: string[], page?: string) {
  return {
    params: Promise.resolve({ date }),
    searchParams: Promise.resolve({ page }),
  };
}

function archiveListElement(node: React.ReactNode): React.ReactElement | undefined {
  if (!React.isValidElement(node)) return undefined;
  if (node.type === ArchiveStoryList) return node;
  const children = (node.props as { children?: React.ReactNode }).children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = archiveListElement(child);
      if (found) return found;
    }
  }
  return archiveListElement(children);
}

function storyFeedElement(
  node: React.ReactNode,
): React.ReactElement<MockStoryFeedProps> | undefined {
  if (!React.isValidElement(node)) return undefined;
  if (node.type === MockStoryFeed) return node as React.ReactElement<MockStoryFeedProps>;
  const children = (node.props as { children?: React.ReactNode }).children;
  if (Array.isArray(children)) {
    for (const child of children) {
      const found = storyFeedElement(child);
      if (found) return found;
    }
  }
  return storyFeedElement(children);
}

test("latest archive renders the deferred list without starting a story read", async () => {
  events.length = 0;
  const shell = await ArchivePage(props());
  const list = archiveListElement(shell);
  assert.ok(list);
  assert.deepEqual(list.props, { month: null, page: 1 });
  assert.deepEqual(events, []);
});

test("dated pages validate month existence before reading stories", async () => {
  events.length = 0;
  archiveResult = { stories: [], hasNext: false };
  const shell = await ArchivePage(props(["2026", "09"]));
  const list = archiveListElement(shell);
  assert.ok(list);
  assert.deepEqual(list.props, { month: "2026-09", page: 1 });
  assert.deepEqual(events, ["months"]);

  events.length = 0;
  archiveMonths = [];
  await assert.rejects(ArchivePage(props(["2026", "08"])), (error) => error === routeSignal);
  assert.deepEqual(events, ["months"]);
  archiveMonths = [{ month: "2026-09" }];
});

test("invalid date and page guards run before any data read", async () => {
  for (const input of [props(["2026"]), props(undefined, "01")]) {
    events.length = 0;
    await assert.rejects(generateMetadata(input), (error) => error === routeSignal);
    assert.deepEqual(events, []);

    await assert.rejects(ArchivePage(input), (error) => error === routeSignal);
    assert.deepEqual(events, []);
  }
});

test("later pages resolve their story feed before rendering", async () => {
  events.length = 0;
  archiveResult = { stories: [story("1")], hasNext: true };
  const shell = await ArchivePage(props(undefined, "2"));
  const feed = storyFeedElement(shell);
  assert.ok(feed);
  assert.equal(feed.props.initialStories instanceof Array, true);
  assert.equal(feed.props.initialStories.length, 1);
  assert.deepEqual(events, ["stories:latest:2"]);

  events.length = 0;
  archiveResult = { stories: [], hasNext: false };
  await assert.rejects(ArchivePage(props(undefined, "2")), (error) => error === routeSignal);
  assert.deepEqual(events, ["stories:latest:2"]);
});

test("document requests block on page one and preserve a valid empty feed", async () => {
  events.length = 0;
  streamBrowse = false;
  archiveResult = { stories: [], hasNext: false };
  const shell = await ArchivePage(props());
  const feed = storyFeedElement(shell);
  assert.ok(feed);
  assert.equal(feed.props.initialStories.length, 0);
  assert.deepEqual(events, ["stories:latest:1"]);
  streamBrowse = true;
});

test("deferred story outages use the fallback and unexpected errors propagate", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  events.length = 0;
  archiveFailure = new DataUnavailableError();
  const html = renderToStaticMarkup(await ArchiveStoryList({ month: null, page: 1 }));
  assert.match(html, /temporarily unavailable/i);
  assert.deepEqual(events, ["stories:latest:1"]);
  archiveFailure = null;

  events.length = 0;
  const unexpected = new Error("query programming error");
  archiveFailure = unexpected;
  await assert.rejects(ArchiveStoryList({ month: null, page: 1 }), (error) => error === unexpected);
  assert.deepEqual(events, ["stories:latest:1"]);
  archiveFailure = null;
});

test("month-index outages use the fallback before streaming", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  events.length = 0;
  monthsFailure = new DataUnavailableError();
  const html = renderToStaticMarkup(await ArchivePage(props(["2026", "09"])));
  assert.match(html, /temporarily unavailable/i);
  assert.deepEqual(events, ["months"]);
  monthsFailure = null;
});

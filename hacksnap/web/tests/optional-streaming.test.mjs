import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { jest, test } from "@jest/globals";
import * as React from "react";
import { renderToPipeableStream } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
const { createElement } = React;

// react-dom/server does not provide the RSC request cache. Model one render
// here; the production browser regressions exercise actual request isolation.
jest.unstable_mockModule("react", () => ({
  ...React,
  cache: (factory) => {
    let value;
    return () => (value ??= factory());
  },
}));

const story = {
  hn_id: "123",
  title: "Primary headline",
  story_slug: "primary-headline-123",
  category: "agents_coding",
  summary: {
    article_summary: "The primary article brief.",
    article_key_points: [],
    discussion_summary: "",
    discussion_points: [],
    sentiment: null,
    overall_takeaway: "Primary takeaway.",
    generated_at: "2026-09-29T12:00:00Z",
    model: "test",
    source_coverage: {
      stored_comments: 0,
      included_comments: 0,
      comments_truncated: false,
      article_status: "fetched",
      sentiment: { included_comments: 0 },
    },
  },
  date_added: new Date("2026-09-29T12:00:00Z"),
  points: 1,
  comment_count: 0,
  url: null,
};
const related = [
  { ...story, hn_id: "456", title: "Next headline", story_slug: "next-headline-456" },
];
const categoryList = { stories: [story], hasNext: false };
const getPopularStories = jest.fn(async () => []);
const events = [];
const getStory = jest.fn(async () => {
  events.push("story");
  return story;
});
const getRelatedStories = jest.fn(async () => {
  events.push("related");
  return related;
});
const getCategoryStories = jest.fn(async () => {
  events.push("list");
  return categoryList;
});
const getCategoryCounts = jest.fn(async () => {
  events.push("counts");
  return { agents_coding: 1 };
});
const shouldStreamBrowse = jest.fn(async () => true);
jest.unstable_mockModule("../lib/browse-streaming.ts", () => ({ shouldStreamBrowse }));
jest.unstable_mockModule("../lib/data.ts", () => ({
  getArchiveStories: async () => categoryList,
  getArchiveMonths: async () => [],
  getPopularStories,
  getStory,
  getRelatedStories,
  getCategoryStories,
  getCategoryCounts,
}));
jest.unstable_mockModule("next/cache", () => ({ unstable_noStore: () => {} }));
const notFoundSignal = new Error("not found");
jest.unstable_mockModule("next/navigation", () => ({
  notFound: () => {
    throw notFoundSignal;
  },
  permanentRedirect: (url) => {
    throw Object.assign(new Error("redirect"), { url });
  },
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({}),
}));

const { default: StoryPage } = await import("../app/story/[id]/page.tsx");
const { SiteContent } = await import("../app/site-content.tsx");
const { default: CategoryPage } = await import("../app/[[...path]]/page.tsx");
const { DataUnavailableError } = await import("../lib/data-availability.ts");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function stream(element) {
  const output = new PassThrough();
  let html = "";
  const errors = [];
  const complete = new Promise((resolve, reject) => {
    output.on("data", (chunk) => {
      html += chunk.toString();
    });
    output.on("end", resolve);
    output.on("error", reject);
  });
  const { pipe } = renderToPipeableStream(
    createElement(AppRouterContext.Provider, { value: {} }, createElement("main", null, element)),
    { onShellReady: () => pipe(output), onError: (error) => errors.push(error) },
  );
  return {
    get html() {
      return html;
    },
    complete,
    errors,
    contains(pattern) {
      if (pattern.test(html)) return Promise.resolve();
      return new Promise((resolve) => {
        const check = () => {
          if (pattern.test(html)) {
            output.off("data", check);
            resolve();
          }
        };
        output.on("data", check);
      });
    },
  };
}

const storyProps = { params: Promise.resolve({ id: "primary-headline-123" }) };
const categoryProps = {
  params: Promise.resolve({}),
  searchParams: Promise.resolve({ category: "agents-coding" }),
};

test("article and sidebar shell stream while popularity is pending", async () => {
  const pending = deferred();
  getPopularStories.mockImplementationOnce(() => pending.promise);
  const rendered = stream(await SiteContent({ children: await StoryPage(storyProps) }));
  await rendered.contains(/Loading most read stories/);
  assert.match(rendered.html, /The primary article brief/);
  assert.match(rendered.html, /browse-right-sidebar/);
  pending.resolve([{ hn_id: "789", title: "Popular headline", views: "10" }]);
  await rendered.complete;
  assert.match(rendered.html, /Popular headline/);
  assert.match(rendered.html, /href="\/story\/789"/);
  assert.deepEqual(rendered.errors, []);
});

test("failed popularity keeps the article and sidebar failure message", async () => {
  getPopularStories.mockRejectedValueOnce(new DataUnavailableError());
  const rendered = stream(await SiteContent({ children: await StoryPage(storyProps) }));
  await rendered.complete;
  assert.match(rendered.html, /The primary article brief/);
  assert.match(rendered.html, /Most read stories are temporarily unavailable/);
  assert.deepEqual(rendered.errors, []);
});

test.each([
  ["article", StoryPage, storyProps, "story"],
  ["feed", CategoryPage, categoryProps, "list"],
])("document %s read runs while popularity is pending", async (_name, Page, props, primary) => {
  shouldStreamBrowse.mockResolvedValue(false);
  const pending = deferred();
  getPopularStories.mockImplementationOnce(() => {
    events.push("popularity");
    return pending.promise;
  });
  events.length = 0;
  // Pass the unevaluated route, just as the root layout receives it from Next.
  const rendered = stream(createElement(SiteContent, null, createElement(Page, props)));
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(events.includes(primary), "primary read must not wait for popularity");
    assert.ok(events.indexOf(primary) < events.indexOf("popularity"), JSON.stringify(events));
    assert.doesNotMatch(rendered.html, /Loading most read stories/);
  } finally {
    pending.resolve([{ hn_id: "789", title: "Popular headline", views: "10" }]);
    await rendered.complete;
    shouldStreamBrowse.mockResolvedValue(true);
  }
  assert.match(rendered.html, /Primary headline/);
  assert.match(rendered.html, /Popular headline/);
  assert.doesNotMatch(rendered.html, /Loading most read stories/);
  assert.deepEqual(rendered.errors, []);
});

test.each([
  ["article", StoryPage, storyProps, getStory, story],
  ["feed", CategoryPage, categoryProps, getCategoryStories, categoryList],
])(
  "document %s completes a cold primary read before popularity starts",
  async (_name, Page, props, read, value) => {
    shouldStreamBrowse.mockResolvedValue(false);
    const primary = deferred();
    const started = deferred();
    read.mockImplementationOnce(async () => {
      started.resolve();
      return primary.promise;
    });
    getPopularStories.mockClear();
    const rendered = stream(createElement(SiteContent, null, createElement(Page, props)));
    try {
      await started.promise;
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(getPopularStories.mock.calls.length, 0);
    } finally {
      primary.resolve(value);
      await rendered.complete;
      shouldStreamBrowse.mockResolvedValue(true);
    }
    assert.equal(getPopularStories.mock.calls.length, 1);
    assert.match(rendered.html, /Primary headline/);
    assert.deepEqual(rendered.errors, []);
  },
);

test("warm primary story streams before a stalled recommendation and retains cards", async () => {
  const pending = deferred();
  getRelatedStories.mockImplementationOnce(async () => {
    events.push("related");
    return pending.promise;
  });
  events.length = 0;
  const page = await StoryPage(storyProps);
  assert.deepEqual(events, ["story"]);
  const rendered = stream(page);
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(rendered.html, /Primary headline/);
  assert.match(rendered.html, /The primary article brief/);
  assert.match(rendered.html, /href="https:\/\/news\.ycombinator\.com\/item\?id=123"/);
  assert.match(rendered.html, /Loading related stories…/);
  assert.doesNotMatch(rendered.html, /Next headline/);
  assert.deepEqual(events, ["story", "related"]);
  pending.resolve(related);
  await rendered.complete;
  assert.match(rendered.html, /Next headline/);
  assert.match(rendered.html, /href="\/story\/next-headline-456"/);
  assert.deepEqual(rendered.errors, []);
});

test("cold story load finishes before optional read gets the single pool connection", async () => {
  const pending = deferred();
  getStory.mockImplementationOnce(async () => {
    events.push("story-start");
    const value = await pending.promise;
    events.push("story-end");
    return value;
  });
  events.length = 0;
  const pagePromise = StoryPage(storyProps);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["story-start"]);
  pending.resolve(story);
  const page = await pagePromise;
  assert.deepEqual(events, ["story-start", "story-end"]);
  const rendered = stream(page);
  await rendered.complete;
  assert.equal(events.at(-1), "related");
  assert.deepEqual(rendered.errors, []);
});

test("filtered Latest streams stories without requesting category counts", async () => {
  const pending = deferred();
  getCategoryStories.mockImplementationOnce(async () => {
    events.push("list-start");
    const value = await pending.promise;
    events.push("list-end");
    return value;
  });
  events.length = 0;
  getCategoryCounts.mockClear();
  const rendered = stream(await CategoryPage(categoryProps));
  await rendered.contains(/Loading stories/);
  assert.deepEqual(events, ["list-start"]);
  pending.resolve(categoryList);
  await rendered.complete;
  assert.match(rendered.html, /Primary headline/);
  assert.deepEqual(events, ["list-start", "list-end"]);
  assert.equal(getCategoryCounts.mock.calls.length, 0);
  assert.deepEqual(rendered.errors, []);
});

test("failed optional queries finish the stream with useful primary content", async () => {
  getRelatedStories.mockRejectedValueOnce(new DataUnavailableError());
  const article = stream(await StoryPage(storyProps));
  await article.complete;
  assert.match(article.html, /Primary headline/);
  assert.match(article.html, /More in Agents/);
  assert.deepEqual(article.errors, []);

  getCategoryCounts.mockClear();
  const list = stream(await CategoryPage(categoryProps));
  await list.complete;
  assert.match(list.html, /Primary headline/);
  assert.doesNotMatch(list.html, /category-count-placeholder/);
  assert.equal(getCategoryCounts.mock.calls.length, 0);
  assert.deepEqual(list.errors, []);
});

test("canonical redirect and absent primary story never start recommendations", async () => {
  getRelatedStories.mockClear();
  await assert.rejects(
    StoryPage({ params: Promise.resolve({ id: "123" }) }),
    (error) => error.url === "/story/primary-headline-123",
  );
  getStory.mockResolvedValueOnce(null);
  await assert.rejects(StoryPage(storyProps), (error) => error === notFoundSignal);
  assert.equal(getRelatedStories.mock.calls.length, 0);
});

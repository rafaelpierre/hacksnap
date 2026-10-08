import assert from "node:assert/strict";
import { jest, test } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import type { ArticleStory } from "../lib/story-domain";
import { leadDiscussionPreview, readLeadDiscussionPreview } from "../lib/feed-presentation";
import { publicFeedStory } from "../lib/stories-api";
import { WindowedStoryList } from "../app/windowed-story-list";
import { StoryRow } from "../app/story-row";

const story: ArticleStory = {
  hn_id: "90000001",
  title: "A feed story",
  category: "agents_coding",
  url: "https://example.com/article",
  points: 42,
  comment_count: 12,
  date_added: new Date("2026-10-01T12:00:00Z"),
  image_status: "ready",
  image_url: "https://store.public.blob.vercel-storage.com/articles/90000001.webp",
  image_width: 1200,
  image_height: 675,
  image_mime_type: "image/webp",
  summary: {
    overall_takeaway: "The article takeaway.",
    sentiment: 0,
    source_coverage: {
      stored_comments: 12,
      included_comments: 12,
      comments_truncated: false,
      article_status: "fetched",
    },
    article_summary: "Article detail",
    article_key_points: [],
    discussion_summary: "Older discussion summary must remain hidden.",
    discussion_points: [],
    generated_at: "2026-10-01T13:00:00Z",
    model: "test",
    discussion_analysis: {
      status: "available",
      reference_claims: [],
      critical_comments: [],
      supportive_comments: [],
      topics: [
        {
          key: "cost",
          title: "Costs",
          summary: "The current analysis discusses operating costs.",
          comment_ids: [1],
        },
        {
          key: "evidence",
          title: "Evidence",
          summary: "Readers ask about reproducibility.",
          comment_ids: [2],
        },
        {
          key: "other",
          title: "Other",
          summary: "A third topic must not enter the bounded preview.",
          comment_ids: [3],
        },
      ],
    },
  },
};
function render(element: React.ReactElement) {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={{} as never}>{element}</AppRouterContext.Provider>,
  );
}

test("lead preview uses only usable current topic summaries and remains bounded", () => {
  assert.deepEqual(leadDiscussionPreview(story), {
    storyId: story.hn_id,
    text: "The current analysis discusses operating costs. Readers ask about reproducibility.",
  });
  assert.equal(leadDiscussionPreview(null), null);
  assert.equal(leadDiscussionPreview({ ...story, summary: null }), null);
  for (const discussion_analysis of [
    null,
    { ...story.summary!.discussion_analysis!, status: "no_comments" as const },
    { ...story.summary!.discussion_analysis!, status: "insufficient_context" as const },
    { ...story.summary!.discussion_analysis!, topics: [] },
    {
      ...story.summary!.discussion_analysis!,
      topics: [{ key: "cost" as const, title: "Cost", summary: "  ", comment_ids: [] }],
    },
  ]) {
    assert.equal(
      leadDiscussionPreview({ ...story, summary: { ...story.summary!, discussion_analysis } }),
      null,
    );
  }
  const long = leadDiscussionPreview({
    ...story,
    summary: {
      ...story.summary!,
      discussion_analysis: {
        ...story.summary!.discussion_analysis!,
        topics: [
          {
            key: "cost",
            title: "Cost",
            summary: "A lengthy current analysis. ".repeat(40),
            comment_ids: [],
          },
        ],
      },
    },
  });
  assert.ok(long && long.text.length <= 220);
});

test("optional preview reads only the requested initial lead and omits any read failure", async () => {
  const reads: string[] = [];
  const read = async (id: string) => {
    reads.push(id);
    return story;
  };
  assert.equal(await readLeadDiscussionPreview(null, read), null);
  assert.equal((await readLeadDiscussionPreview(story.hn_id, read))?.storyId, story.hn_id);
  assert.deepEqual(reads, [story.hn_id]);
  assert.equal(await readLeadDiscussionPreview("90000002", read), null);
  assert.equal(
    await readLeadDiscussionPreview(story.hn_id, async () => {
      throw new Error("optional read failed");
    }),
    null,
  );
  assert.equal(await readLeadDiscussionPreview(story.hn_id, async () => null), null);
});

test("lead card reading order and actions preserve category metadata in selected topic feeds", () => {
  const html = render(
    <StoryRow
      story={publicFeedStory(story)}
      lead
      showCategory={false}
      discussionPreview={leadDiscussionPreview(story)}
    />,
  );
  const markers = [
    "story-context",
    '<h2 class="feed-story-title"',
    "feed-excerpt",
    'class="feed-story-image"',
    "feed-discussion-preview",
    'class="feed-story-rail"',
  ];
  const positions = markers.map((marker) => html.indexOf(marker));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b),
  );
  assert.match(html, /Browse Agents/);
  assert.doesNotMatch(html, /Read brief|Discussion analysis|Share:/);
  assert.match(html, /<h2 class="feed-story-title">/);
  assert.match(html, /<h3>Inside the discussion<\/h3>/);
  assert.match(html, /href="\/story\/90000001"/);
  assert.doesNotMatch(html, /Older discussion summary|third topic/);
  assert.doesNotMatch(
    JSON.stringify(publicFeedStory(story)),
    /discussion_analysis|current analysis|Article detail/,
  );
});

test("logical lead survives append and is not reassigned to a virtual window or stale preview", () => {
  const stories = Array.from({ length: 180 }, (_, index) =>
    publicFeedStory({ ...story, hn_id: String(90000001 + index) }),
  );
  const list = (count: number, pinnedStoryId?: string, preview = leadDiscussionPreview(story)) =>
    render(
      <WindowedStoryList
        stories={stories.slice(0, count)}
        ranked={false}
        initialPage={1}
        groupByDay={false}
        leadImagePriority={false}
        leadStoryId={story.hn_id}
        discussionPreview={preview}
        pinnedStoryId={pinnedStoryId}
      />,
    );
  for (const count of [15, 30, 180]) {
    const html = list(count);
    assert.equal((html.match(/feed-story-lead/g) ?? []).length, 1);
    assert.equal((html.match(/feed-discussion-preview/g) ?? []).length, 1);
  }
  const deep = list(180, stories[150]!.hn_id);
  assert.doesNotMatch(deep, /feed-story-lead|feed-discussion-preview/);
  const stale = list(30, undefined, {
    storyId: "123",
    text: "Preview from a newer server listing",
  });
  assert.match(stale, /feed-story-lead/);
  assert.doesNotMatch(stale, /feed-discussion-preview|Preview from a newer/);
});

test("a stalled optional preview cannot hold the feed beyond its 500ms budget", async () => {
  jest.useFakeTimers();
  try {
    const pending = readLeadDiscussionPreview(story.hn_id, () => new Promise(() => {}));
    await jest.advanceTimersByTimeAsync(500);
    assert.equal(await pending, null);
    assert.equal(jest.getTimerCount(), 0);
  } finally {
    jest.useRealTimers();
  }
});

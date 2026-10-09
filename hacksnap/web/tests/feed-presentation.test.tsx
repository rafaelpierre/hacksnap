import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import type { CardStory } from "../lib/story-domain";
import { publicFeedStory } from "../lib/stories-api";
import { WindowedStoryList } from "../app/windowed-story-list";
import { StoryRow } from "../app/story-row";

const story: CardStory = {
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
    discussion_preview: "Readers ask about reproducibility.",
    sentiment: 0,
    source_coverage: {
      stored_comments: 12,
      included_comments: 12,
      comments_truncated: false,
      article_status: "fetched",
    },
  },
};
function render(element: React.ReactElement) {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={{} as never}>{element}</AppRouterContext.Provider>,
  );
}

test("every card places its discussion below the image and above its actions", () => {
  for (const lead of [true, false]) {
    const html = render(
      <StoryRow story={publicFeedStory(story)} lead={lead} showCategory={false} />,
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
    assert.match(html, /aria-label="Share: A feed story"/);
    assert.match(html, /<h3>Inside the discussion<\/h3>/);
    assert.match(html, /Readers ask about reproducibility/);
    assert.match(html, /href="\/story\/90000001"/);
  }
});

test("previews are bounded, escaped and omitted when absent", () => {
  const long = publicFeedStory({
    ...story,
    summary: { ...story.summary!, discussion_preview: "A long discussion. ".repeat(40) },
  });
  assert.ok(long.summary!.discussion_preview!.length <= 220);
  for (const discussion_preview of [undefined, null, "", "   "]) {
    const card = publicFeedStory({ ...story, summary: { ...story.summary!, discussion_preview } });
    assert.doesNotMatch(render(<StoryRow story={card} />), /feed-discussion-preview/);
  }
  const unsafe = publicFeedStory({
    ...story,
    summary: { ...story.summary!, discussion_preview: "<script>alert(1)</script>" },
  });
  assert.match(render(<StoryRow story={unsafe} />), /&lt;script&gt;/);
});

test("appended and virtualized cards retain their own discussion previews", () => {
  const stories = Array.from({ length: 180 }, (_, index) =>
    publicFeedStory({
      ...story,
      hn_id: String(90000001 + index),
      summary: { ...story.summary!, discussion_preview: `Discussion for story ${index + 1}.` },
    }),
  );
  const list = (count: number, pinnedStoryId?: string) =>
    render(
      <WindowedStoryList
        stories={stories.slice(0, count)}
        ranked={false}
        initialPage={1}
        groupByDay={false}
        leadImagePriority={false}
        leadStoryId={story.hn_id}
        pinnedStoryId={pinnedStoryId}
      />,
    );
  for (const count of [15, 30, 180]) {
    const html = list(count);
    assert.equal(
      (html.match(/feed-discussion-preview/g) ?? []).length,
      (html.match(/data-home-story-id=/g) ?? []).length,
    );
    assert.match(html, /Discussion for story 2\./);
  }
  const deep = list(180, stories[150]!.hn_id);
  assert.match(deep, /Discussion for story 151\./);
  assert.doesNotMatch(deep, /Discussion for story 1\./);
});

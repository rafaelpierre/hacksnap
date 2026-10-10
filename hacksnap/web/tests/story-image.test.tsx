import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { StoryRow } from "../app/story-row";
import { storyPreviewMetadata } from "../lib/preview-metadata";
import { readyStoryImage } from "../lib/story-image";
import { publicFeedStory } from "../lib/stories-api";
import { WindowedStoryList } from "../app/windowed-story-list";
import type { Story } from "../lib/data";

const blobURL = "https://caiasssg5nuaa1i1.public.blob.vercel-storage.com/articles/90000001.webp";

const story: Story = {
  hn_id: "90000001",
  title: "Stored image story",
  category: null,
  url: "https://example.com/article",
  points: 12,
  comment_count: 3,
  date_added: new Date("2026-09-29T12:00:00Z"),
  summary: null,
  image_url: blobURL,
  image_status: "ready",
  image_width: 1200,
  image_height: 675,
  image_mime_type: "image/webp",
};

function render(element: React.ReactElement) {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={{} as never}>{element}</AppRouterContext.Provider>,
  );
}

function imageURL(images: { url: string } | { url: string }[] | undefined) {
  return Array.isArray(images) ? images[0]?.url : images?.url;
}

test("story previews accept ready proportional article Blob images", () => {
  assert.equal(readyStoryImage(story)?.url, blobURL);
  assert.deepEqual(readyStoryImage({ ...story, image_status: "pending" }), null);
  assert.deepEqual(readyStoryImage({ ...story, image_status: "failed" }), null);
  assert.deepEqual(readyStoryImage({ ...story, image_url: null }), null);
  assert.deepEqual(
    readyStoryImage({ ...story, image_url: "https://publisher.example/hero.webp" }),
    null,
  );
  assert.deepEqual(readyStoryImage({ ...story, image_width: 0 }), null);
});

test("cards never emit the publisher source URL and omit unavailable images", () => {
  const withSource = { ...story, image_source_url: "https://publisher.example/hero.webp" };
  const readyHTML = render(<StoryRow story={withSource} variant="ranked" />);
  assert.match(readyHTML, new RegExp(blobURL.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
  assert.doesNotMatch(readyHTML, /publisher\.example/);
  assert.match(readyHTML, /width="1200" height="675"/);
  for (const image_status of ["pending", "failed", null] as const) {
    const html = render(<StoryRow story={{ ...story, image_status }} />);
    assert.doesNotMatch(html, /feed-story-image/);
  }
});

test("social metadata uses the canonical story card regardless of stored image availability", () => {
  for (const image_status of ["ready", "pending", "failed", null] as const) {
    const imageStory = { ...story, image_status };
    const metadata = storyPreviewMetadata(imageStory);
    assert.equal(
      imageURL(metadata.openGraph?.images as { url: string }[]),
      "https://hacksnap.live/story/90000001/opengraph-image",
    );
    assert.equal(
      imageURL(metadata.twitter?.images as { url: string }[]),
      "https://hacksnap.live/story/90000001/opengraph-image",
    );
  }
});

test("ranked and unranked feed images preserve source dimensions without a fitting override", () => {
  for (const variant of ["ranked", "unranked"] as const) {
    for (const image_height of [630, 800, 1200, 1800]) {
      const html = render(<StoryRow story={{ ...story, image_height }} variant={variant} />);
      assert.match(html, /class="feed-story-image"/);
      assert.doesNotMatch(html, /object-fit:/);
      assert.match(html, new RegExp(`width="1200" height="${image_height}"`));
    }
  }
});

test("only an explicitly marked ready lead image gets eager high priority", () => {
  const lead = render(<StoryRow story={story} leadImage />);
  assert.match(lead, /loading="eager"/);
  assert.match(lead, /fetchPriority="high"/);
  assert.match(lead, /sizes="\(min-width: 78rem\)/);

  const following = render(<StoryRow story={story} />);
  assert.match(following, /loading="lazy"/);
  assert.doesNotMatch(following, /fetchPriority=/);

  const unavailableLead = render(
    <StoryRow story={{ ...story, image_status: "pending" }} leadImage />,
  );
  assert.doesNotMatch(unavailableLead, /<img/);
});

test("the first eligible image alone takes priority, including on later pages", () => {
  const first = publicFeedStory(story);
  const second = publicFeedStory({ ...story, hn_id: "90000002" });
  const list = (stories: (typeof first)[], pinnedStoryId?: string) =>
    render(
      <WindowedStoryList
        stories={stories}
        ranked
        initialPage={2}
        groupByDay={false}
        pinnedStoryId={pinnedStoryId}
        leadImagePriority
      />,
    );
  assert.deepEqual(
    [...list([first, second]).matchAll(/<img[^>]+>/g)].map((match) =>
      match[0].includes('fetchPriority="high"'),
    ),
    [true, false],
  );
  const noFirstImage = list([publicFeedStory({ ...story, image_status: "pending" }), second]);
  assert.match(noFirstImage, /fetchPriority="high"/);
  assert.match(noFirstImage, /loading="eager"/);
  assert.doesNotMatch(list([first, second], second.hn_id), /fetchPriority="high"/);
});

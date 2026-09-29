import assert from "node:assert/strict";
import { test } from "@jest/globals";
import { storyPreviewMetadata } from "../lib/preview-metadata.ts";
import { sitemapEntries } from "../lib/sitemap.ts";
import { renderRSS } from "../lib/rss.ts";
import { leaderboardMarkdown } from "../lib/markdown.ts";
import { suggestedPost } from "../lib/share-text.ts";

test("mixed old and new stories keep one saved address across public formats", () => {
  const old = {
    hn_id: "123",
    title: "Changed old title",
    story_slug: null,
    date_added: new Date(0),
    points: 1,
    comment_count: 0,
    summary: null,
  };
  const fresh = {
    ...old,
    hn_id: "124",
    title: "Changed new title",
    story_slug: "original-title-124",
  };
  for (const [story, path] of [
    [old, "/story/123"],
    [fresh, "/story/original-title-124"],
  ]) {
    const url = `https://hacksnap.live${path}`;
    assert.equal(storyPreviewMetadata(story).alternates.canonical, url);
    assert.equal(sitemapEntries([{ ...story, modified_at: new Date(0) }])[1].url, url);
    assert.ok(renderRSS([story]).includes(`<link>${url}</link>`));
    assert.ok(suggestedPost(story.hn_id, story.title, null, story.story_slug).endsWith(url));
    const summary = { overall_takeaway: "Ready", source_coverage: { included_comments: 0 } };
    assert.ok(
      leaderboardMarkdown({ stories: [{ ...story, summary }], ingestion: null }).includes(url),
    );
  }
});

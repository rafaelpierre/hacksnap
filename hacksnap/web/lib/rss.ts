import { canonicalStoryUrl } from "./story-url";
import type { Story } from "./data";
import { storyIndicators } from "./story-indicators.ts";

function html(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xml(value: string): string {
  return html(
    // XML 1.0 excludes control characters and unpaired surrogates.
    // oxlint-disable-next-line no-control-regex -- Remove characters forbidden by XML 1.0.
    value.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, ""),
  );
}

export function renderRSS(stories: Story[], asOf = new Date().toISOString()): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>Hacksnap — AI on Hacker News</title>
<link>https://hacksnap.live/</link>
<description>AI stories from Hacker News, with article briefs and highlights from the discussion.</description>
<language>en</language>
<atom:link href="https://hacksnap.live/feed.xml" rel="self" type="application/rss+xml" />
${stories
  .map((story) => {
    const url = canonicalStoryUrl(story.hn_id, story.story_slug);
    const summary = story.summary;
    const description = summary
      ? [summary.overall_takeaway, summary.article_summary, summary.discussion_summary]
          .filter(Boolean)
          .join("\n\n")
      : "Summary pending. Read the original sources and Hacker News discussion on Hacksnap.";
    // Readers interpret the XML-decoded description as HTML. Escape its entire
    // plain-text content for that second parser before serializing it as XML.
    const descriptionHtml = html(
      [
        description,
        `${story.points} points · ${story.comment_count} comments`,
        ...storyIndicators(story, story.observed_at ?? asOf),
      ].join("\n\n"),
    );
    return `<item>
<title>${xml(story.title)}</title>
<link>${xml(url)}</link>
<guid isPermaLink="true">${xml(`https://hacksnap.live/story/${story.hn_id}`)}</guid>
<pubDate>${story.date_added.toUTCString()}</pubDate>
<description>${xml(descriptionHtml)}</description>
</item>`;
  })
  .join("\n")}
</channel>
</rss>`;
}

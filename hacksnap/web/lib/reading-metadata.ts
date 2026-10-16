import "server-only";
import { createHash } from "node:crypto";
import type { Story } from "./data";
import type { ReadingContext, SectionType } from "./reading-contract";
import { summaryPlainText } from "./summary-format";
import { storyDiscussion, storySource } from "./story-presentation";

export function readingContext(story: Story): ReadingContext {
  const summary = story.summary;
  const source = storySource(story.url, summary);
  // Hash editorial inputs, not refresh timestamps or popularity counts.
  const revision = createHash("sha256")
    .update(
      JSON.stringify([
        story.title,
        summary?.overall_takeaway,
        summary?.article_summary,
        summary?.article_key_points,
        storyDiscussion(summary),
        source.brief,
      ]),
    )
    .digest("hex")
    .slice(0, 16);
  return {
    reading_version: 1,
    story_id: story.hn_id,
    content_revision: revision,
    layout_variant: "article-2026-10",
    copy_variant: "published",
    category: story.category ?? "unknown",
    summary_status: summary ? source.brief : "pending",
  };
}

export function readingSection(type: SectionType, text = "", index = 1) {
  const plain = summaryPlainText(text).trim();
  return {
    "data-reading-section": type,
    "data-reading-id": `${type}_${index}`,
    "data-reading-words": plain ? plain.split(/\s+/u).length : 0,
  };
}

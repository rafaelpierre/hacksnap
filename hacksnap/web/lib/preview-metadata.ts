import { canonicalStoryUrl } from "./story-url";
import type { Metadata } from "next";
import type { Summary } from "./data";
import { readyStoryImage, type StoryImageFields } from "./story-image";
import { storyDiscussion } from "./story-presentation";

type PreviewSummary = Pick<
  Summary,
  | "article_summary"
  | "discussion_summary"
  | "discussion_points"
  | "discussion_analysis"
  | "discussion_analysis_coverage"
  | "overall_takeaway"
  | "source_coverage"
>;

/** Editorial length targets, not platform limits. Keep complete words where possible. */
export function previewText(value: string, limit: number): string {
  const clean = value.replace(/\s+/gu, " ").trim();
  const characters = Array.from(clean);
  if (characters.length <= limit) return clean;
  const clipped = characters.slice(0, limit - 1).join("");
  // If the next character is whitespace, the current word already fits in full.
  const boundary = clipped.lastIndexOf(" ");
  const text =
    /\s/u.test(characters[limit - 1]) || boundary < 0 ? clipped : clipped.slice(0, boundary);
  return (
    text
      .trimEnd()
      .replace(/[,:;–—-]+$/u, "")
      .trimEnd() + "…"
  );
}

function reactionDescription(summary: PreviewSummary | null): string {
  if (!summary) {
    return "Article and Hacker News reaction summary pending. Follow the links to the original source and full discussion on Hacksnap.";
  }
  const hasArticle = Boolean(summary.article_summary?.trim());
  const discussion = storyDiscussion(summary);
  if (discussion.kind === "analysis" && discussion.status === "no_comments") {
    return `${hasArticle ? "Article summary. " : ""}No usable Hacker News comments were available for discussion analysis. ${summary.overall_takeaway}`;
  }
  if (discussion.kind === "analysis") {
    const count = discussion.coverage?.included_comments;
    const sample =
      count === undefined
        ? "Hacker News discussion analysis"
        : `Hacker News discussion analysis of ${count.toLocaleString("en-GB")} sampled ${count === 1 ? "comment" : "comments"}`;
    const introduction = hasArticle ? `Article summary and ${sample}.` : `${sample}.`;
    const topics = discussion.topics
      .map((topic) => topic.title.trim())
      .filter(Boolean)
      .slice(0, 3)
      .join("; ");
    return `${introduction} ${topics ? `Topics: ${topics}` : summary.overall_takeaway}`;
  }
  if (discussion.kind === "legacy_empty") {
    const explanation =
      discussion.coverage.included_comments === 0
        ? "No Hacker News comments were included in this summary."
        : "No usable discussion was available for this summary.";
    return `${hasArticle ? "Article summary. " : ""}${explanation} ${summary.overall_takeaway}`;
  }
  // The legacy brief's sample is independent from a later analysis refresh.
  const count = discussion.kind === "legacy" ? discussion.coverage.included_comments : 0;
  if (count === 0) {
    return `${hasArticle ? "Article summary. " : ""}No Hacker News comments were included in this summary. ${summary.overall_takeaway}`;
  }
  const comments = `${count.toLocaleString("en-GB")} sampled ${count === 1 ? "comment" : "comments"}`;
  const introduction = hasArticle
    ? `Article summary and Hacker News reactions from ${comments}.`
    : `Hacker News reactions from ${comments}.`;
  const topics = discussion.topics
    .map((point) => point.title.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("; ");
  return `${introduction} ${topics ? `Topics: ${topics}` : summary.overall_takeaway}`;
}

export function storyPreviewMetadata(
  story: StoryImageFields & {
    hn_id: string;
    title: string;
    story_slug?: string | null;
    summary: PreviewSummary | null;
  },
): Metadata {
  // Keep preview headlines compact while retaining the brand in the SEO title.
  const title = previewText(story.title, 60);
  const pageTitle = `${title} | Hacksnap`;
  const reaction = reactionDescription(story.summary);
  const description = previewText(reaction, 155);
  const socialDescription = previewText(reaction, 125);
  const url = canonicalStoryUrl(story.hn_id, story.story_slug);
  // A story route metadata file would have higher priority than this metadata.
  // The ready Blob URL or this site-level brand card is therefore declared here.
  const storedImage = readyStoryImage(story);
  const image = storedImage
    ? {
        url: storedImage.url,
        alt: story.title,
        width: storedImage.width,
        height: storedImage.height,
      }
    : {
        url: "https://hacksnap.live/opengraph-image",
        alt: story.title,
        width: 1200,
        height: 630,
      };
  return {
    title: { absolute: pageTitle },
    description,
    robots: { index: story.summary !== null, follow: true },
    alternates: {
      canonical: url,
      types: { "application/rss+xml": "https://hacksnap.live/feed.xml" },
    },
    openGraph: {
      title,
      description: socialDescription,
      siteName: "Hacksnap",
      url,
      type: "article",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: socialDescription,
      images: [image],
    },
  };
}

import type { Metadata } from "next";
import type { Summary } from "./data";

type PreviewSummary = Pick<Summary, "article_summary" | "discussion_points" | "overall_takeaway" | "source_coverage">;

/** Editorial length targets, not platform limits. Keep complete words where possible. */
export function previewText(value: string, limit: number): string {
  const clean = value.replace(/\s+/gu, " ").trim();
  const characters = Array.from(clean);
  if (characters.length <= limit) return clean;
  const clipped = characters.slice(0, limit - 1).join("");
  // If the next character is whitespace, the current word already fits in full.
  const boundary = clipped.lastIndexOf(" ");
  const text = /\s/u.test(characters[limit - 1]) || boundary < 0
    ? clipped : clipped.slice(0, boundary);
  return text.trimEnd().replace(/[,:;–—-]+$/u, "").trimEnd() + "…";
}

function reactionDescription(summary: PreviewSummary | null): string {
  if (!summary) {
    return "Article and Hacker News reaction summary pending. Follow the links to the original source and full discussion on Hacksnap.";
  }
  const hasArticle = Boolean(summary.article_summary?.trim());
  // Describe the sample actually summarized, not the thread's total comment count.
  const count = summary.source_coverage.included_comments;
  if (count === 0) {
    return `${hasArticle ? "Article summary. " : ""}No Hacker News comments were included in this summary. ${summary.overall_takeaway}`;
  }
  const comments = `${count.toLocaleString("en-GB")} sampled ${count === 1 ? "comment" : "comments"}`;
  const introduction = hasArticle
    ? `Article summary and Hacker News reactions from ${comments}.`
    : `Hacker News reactions from ${comments}.`;
  const topics = summary.discussion_points.map(point => point.title.trim()).filter(Boolean).slice(0, 3).join("; ");
  return `${introduction} ${topics ? `Topics: ${topics}` : summary.overall_takeaway}`;
}

export function storyPreviewMetadata(story: {
  hn_id: string;
  title: string;
  summary: PreviewSummary | null;
}): Metadata {
  // Clip only the source headline so the reaction positioning and brand always survive.
  const title = `${previewText(story.title, 60)} — Hacker News reactions`;
  const pageTitle = `${title} | Hacksnap`;
  const reaction = reactionDescription(story.summary);
  const description = previewText(reaction, 155);
  const socialDescription = previewText(reaction, 125);
  const url = `https://hacksnap.live/story/${story.hn_id}`;
  return {
    title: {absolute: pageTitle},
    description,
    robots: {index: story.summary !== null, follow: true},
    alternates: {
      canonical: url,
      types: {"application/rss+xml": "https://hacksnap.live/feed.xml"},
    },
    openGraph: {title, description: socialDescription, siteName: "Hacksnap", url, type: "article"},
    twitter: {
      card: "summary_large_image", title, description: socialDescription,
      images: [{url: `${url}/opengraph-image`, alt: story.title}],
    },
  };
}

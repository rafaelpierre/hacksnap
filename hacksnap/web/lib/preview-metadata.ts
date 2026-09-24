import type { Metadata } from "next";

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

export function storyPreviewMetadata(story: {
  hn_id: string;
  title: string;
  summary: {overall_takeaway: string} | null;
}): Metadata {
  const title = previewText(story.title, 60);
  const suffix = " | Hacksnap";
  const pageTitle = Array.from(title + suffix).length <= 60 ? title + suffix : title;
  const takeaway = story.summary?.overall_takeaway?.trim() ||
    `Read ${story.title} and its Hacker News discussion on Hacksnap.`;
  const description = previewText(takeaway, 155);
  const socialDescription = previewText(takeaway, 125);
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

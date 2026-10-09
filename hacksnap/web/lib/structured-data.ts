import type { ArticleStory } from "./story-domain";
import { canonicalArticleImage } from "./article-image";
import { categoryById, categoryURL } from "./categories";
import { hasPublishedTakeaway } from "./ready-stories";
import { canonicalStoryUrl } from "./story-url";
import { storyDiscussion } from "./story-presentation";

const siteURL = "https://hacksnap.live/";
const organization = {
  "@type": "Organization",
  "@id": `${siteURL}#organization`,
  name: "Hacksnap",
  url: siteURL,
  logo: {
    "@type": "ImageObject",
    url: `${siteURL}apple-icon.png`,
    width: 180,
    height: 180,
  },
};

export const siteStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${siteURL}#website`,
      name: "Hacksnap",
      url: siteURL,
      publisher: { "@id": organization["@id"] },
    },
    organization,
  ],
};

export function storyStructuredData(story: ArticleStory) {
  const summary = story.summary;
  if (!summary || !hasPublishedTakeaway(summary.overall_takeaway)) return null;

  const url = canonicalStoryUrl(story.hn_id, story.story_slug);
  const category = categoryById(story.category);
  const image = canonicalArticleImage(story);
  const discussion = storyDiscussion(summary);
  const topics =
    discussion.kind === "legacy" ||
    (discussion.kind === "analysis" && discussion.status !== "no_comments")
      ? discussion.topics
      : [];
  const discussionText = topics.map((topic) => `${topic.title}\n${topic.summary}`).join("\n\n");
  const analyzedAt = summary.discussion_analyzed_at
    ? Date.parse(summary.discussion_analyzed_at)
    : NaN;
  const discussionPosts =
    discussion.kind === "analysis" &&
    discussion.status !== "no_comments" &&
    Number.isFinite(analyzedAt)
      ? discussion.topics.map((topic, index) => ({
          "@type": "DiscussionForumPosting",
          "@id": `${url}#discussion-topic-${topic.key}-${index}`,
          url: `${url}#discussion-topic-${topic.key}-${index}`,
          headline: topic.title,
          text: topic.summary,
          author: { "@type": "Organization", name: "Hacksnap", url: `${siteURL}about` },
          datePublished: new Date(analyzedAt).toISOString(),
          isPartOf: { "@id": `${url}#article` },
          citation: topic.comment_ids.map((id) => `https://news.ycombinator.com/item?id=${id}`),
        }))
      : [];
  const articleBody = [
    summary.overall_takeaway.trim(),
    ...(summary.article_summary?.trim()
      ? [summary.article_summary, ...summary.article_key_points]
      : []),
    ...(discussionText ? ["Discussion analysis", discussionText] : []),
  ].join("\n\n");
  // Generation can replace an earlier brief, so it isn't a first-publication date.
  const modified = [
    summary.generated_at,
    discussion.kind === "analysis" ? summary.discussion_analyzed_at : null,
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  const breadcrumbs = [
    { name: "Latest", item: siteURL },
    ...(category
      ? [{ name: category.label, item: new URL(categoryURL(category), siteURL).href }]
      : []),
    { name: story.title, item: url },
  ];

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${url}#article`,
        url,
        mainEntityOfPage: { "@type": "WebPage", "@id": url },
        headline: story.title,
        description: summary.overall_takeaway.trim().replace(/\s+/g, " "),
        articleBody,
        inLanguage: "en",
        isAccessibleForFree: true,
        author: { "@type": "Organization", name: "Hacksnap", url: `${siteURL}about` },
        publisher: organization,
        ...(category ? { articleSection: category.label } : {}),
        ...(modified.length ? { dateModified: new Date(Math.max(...modified)).toISOString() } : {}),
        ...(image ? { image: [image.url] } : {}),
        ...(discussionText
          ? {
              hasPart: {
                "@type": "WebPageElement",
                "@id": `${url}#discussion-analysis`,
                name: "Discussion analysis",
                text: discussionText,
                citation: [...new Set(topics.flatMap((topic) => topic.comment_ids))].map(
                  (id) => `https://news.ycombinator.com/item?id=${id}`,
                ),
                ...(discussionPosts.length
                  ? { hasPart: discussionPosts.map((post) => ({ "@id": post["@id"] })) }
                  : {}),
              },
            }
          : {}),
      },
      {
        "@type": "BreadcrumbList",
        "@id": `${url}#breadcrumb`,
        itemListElement: breadcrumbs.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          ...item,
        })),
      },
      ...discussionPosts,
    ],
  };
}

// Titles and summaries can contain HTML, including a closing script tag.
export function serializeStructuredData(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

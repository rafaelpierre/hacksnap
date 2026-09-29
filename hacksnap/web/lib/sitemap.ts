import { canonicalStoryUrl } from "./story-url";
export function sitemapEntries(stories: { hn_id: string; title: string; modified_at: Date }[]) {
  const latest = stories.reduce<Date | undefined>(
    (value, story) => (!value || story.modified_at > value ? story.modified_at : value),
    undefined,
  );
  return [
    { url: "https://hacksnap.live/", ...(latest ? { lastModified: latest } : {}) },
    ...stories.map((story) => ({
      url: canonicalStoryUrl(story.hn_id, story.title),
      lastModified: story.modified_at,
    })),
  ];
}

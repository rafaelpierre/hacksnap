export function sitemapEntries(stories: {hn_id: string; modified_at: Date}[]) {
  const latest = stories.reduce<Date | undefined>((value, story) =>
    !value || story.modified_at > value ? story.modified_at : value, undefined);
  return [
    {url: "https://hacksnap.live/", ...(latest ? {lastModified: latest} : {})},
    ...stories.map(story => ({url: `https://hacksnap.live/story/${story.hn_id}`, lastModified: story.modified_at})),
  ];
}

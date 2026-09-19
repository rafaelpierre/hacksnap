import type { Story } from "./data";

// Keep the public contract independent of internal query fields and diagnostics.
export function publicStory(story: Story) {
  return {
    hn_id: String(story.hn_id),
    title: story.title,
    url: story.url,
    points: story.points,
    comment_count: story.comment_count,
    date_added: story.date_added.toISOString(),
    summary: story.summary ? {
      article_summary: story.summary.article_summary,
      discussion_summary: story.summary.discussion_summary,
      overall_takeaway: story.summary.overall_takeaway,
    } : null,
  };
}

export function storiesHandlers(data: {
  getLeaderboard: () => Promise<{stories: Story[]; ingestion: Date | null}>;
  getStory: (id: string) => Promise<Story | null>;
}) {
  const unavailable = () => Response.json(
    {error: "Stories are temporarily unavailable"},
    {status: 503, headers: {"Cache-Control": "no-store", "Retry-After": "60"}},
  );
  return {
    async list() {
      try {
        const {stories, ingestion} = await data.getLeaderboard();
        return Response.json({stories: stories.map(publicStory), ingestion: ingestion?.toISOString() ?? null});
      } catch { return unavailable(); }
    },
    async detail(id: string) {
      if (!/^[1-9][0-9]{0,14}$/.test(id)) {
        return Response.json({error: "Invalid story ID"}, {status: 400});
      }
      try {
        const story = await data.getStory(id);
        return story ? Response.json(publicStory(story)) : Response.json({error: "Story not found"}, {status: 404});
      } catch { return unavailable(); }
    },
  };
}

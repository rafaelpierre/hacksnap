import type { ReadyStoryPage } from "./data";
import type { CardStory } from "./story-domain";
import { ReadyStoryPageError } from "./ready-story-pagination-errors";
import { canonicalArticleImage } from "./article-image";
import { briefExcerpt } from "./brief";

// This feed contract contains only fields rendered on ranked and unranked cards.
// Cards use the two latest valid observations for their movement badge.
export function publicFeedStory(story: CardStory) {
  const image = canonicalArticleImage(story);
  const coverage = story.summary?.source_coverage;
  return {
    hn_id: String(story.hn_id),
    story_slug: story.story_slug ?? null,
    title: story.title,
    category: story.category ?? null,
    url: story.url,
    points: story.points,
    comment_count: story.comment_count,
    date_added: story.date_added.toISOString(),
    rank: story.rank ?? null,
    is_recent: story.is_recent === true,
    rank_history: (story.rank_history ?? [])
      .filter(
        ({ observed_at, rank }) =>
          Number.isSafeInteger(rank) && rank > 0 && Number.isFinite(Date.parse(observed_at)),
      )
      .slice(-2)
      .map(({ observed_at, rank }) => ({ observed_at, rank })),
    image_url: image?.url ?? null,
    image_status: image ? "ready" : null,
    image_width: image?.width ?? null,
    image_height: image?.height ?? null,
    image_mime_type: image?.mimeType ?? null,
    summary: story.summary
      ? {
          overall_takeaway: story.summary.overall_takeaway,
          sentiment: story.summary.sentiment,
          ...(story.summary.discussion_preview?.trim()
            ? { discussion_preview: briefExcerpt(story.summary.discussion_preview) }
            : {}),
          source_coverage: coverage
            ? {
                stored_comments: coverage.stored_comments,
                included_comments: coverage.included_comments,
                comments_truncated: coverage.comments_truncated,
                article_status: coverage.article_status,
                ...(coverage.sentiment
                  ? { sentiment: { included_comments: coverage.sentiment.included_comments } }
                  : {}),
              }
            : null,
        }
      : null,
  };
}

export type PublicFeedStory = ReturnType<typeof publicFeedStory>;
export type PublicFeedStoryPage = {
  stories: PublicFeedStory[];
  pagination: ReadyStoryPage["pagination"];
  observed_at?: string;
  selectionIds?: string[];
};

export function readyStoriesHandler(data: {
  getReadyStoryPage: (input: {
    cursor?: string;
    pageSize?: number;
    fresh?: boolean;
  }) => Promise<ReadyStoryPage>;
}) {
  return async (request: Request) => {
    const url = new URL(request.url);
    const allowed = new Set(["cursor", "pageSize", "fresh"]);
    if (
      [...url.searchParams.keys()].some((key) => !allowed.has(key)) ||
      [...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)
    )
      return Response.json(
        { error: "Invalid story continuation", code: "invalid_cursor" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const fresh = url.searchParams.get("fresh");
    if ((fresh !== null && fresh !== "1") || (fresh && cursor))
      return Response.json(
        { error: "Invalid story continuation", code: "invalid_cursor" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    const pageSizeValue = url.searchParams.get("pageSize");
    const pageSize =
      pageSizeValue === null
        ? undefined
        : /^[1-9][0-9]*$/.test(pageSizeValue)
          ? Number(pageSizeValue)
          : Number.NaN;
    try {
      const page = await data.getReadyStoryPage({
        cursor,
        pageSize,
        ...(fresh === "1" ? { fresh: true } : {}),
      });
      const response: PublicFeedStoryPage = {
        stories: page.stories.map(publicFeedStory),
        pagination: page.pagination,
        observed_at: page.observed_at,
        selectionIds: page.selectionIds,
      };
      return Response.json(response, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof ReadyStoryPageError) {
        const message =
          error.code === "snapshot_expired"
            ? "Story selection has expired. Start again."
            : error.code === "snapshot_invalidated"
              ? "Story selection is no longer available. Start again."
              : "Invalid story continuation";
        return Response.json(
          { error: message, code: error.code },
          { status: error.status, headers: { "Cache-Control": "no-store" } },
        );
      }
      return Response.json(
        { error: "Stories are temporarily unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
      );
    }
  };
}

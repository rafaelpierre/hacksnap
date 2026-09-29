import type { ReadyStoryPage, Story } from "./data";
import { ReadyStoryPageError } from "./ready-story-pagination-errors";
import {
  type PublicStory,
  validStoryId,
  PUBLIC_CACHE_CONTROL,
  NEGATIVE_CACHE_CONTROL,
} from "./public-story";
import type { DiscussionFields } from "./discussion-analysis";
import { canonicalArticleImage } from "./article-image";

// Explicitly copy every nested field: cached/query objects may contain private extras.
function publicDiscussion(summary: DiscussionFields) {
  const analysis = summary.discussion_analysis;
  if (!analysis) return null;
  const coverage = summary.discussion_analysis_coverage;
  return {
    status: analysis.status,
    analyzed_at: summary.discussion_analyzed_at ?? null,
    coverage: coverage
      ? {
          stored_comments: coverage.stored_comments,
          included_comments: coverage.included_comments,
          comments_truncated: coverage.comments_truncated,
          selection_method: coverage.selection_method,
        }
      : null,
    reference_claims: analysis.reference_claims.map(({ id, text, source }) => ({
      id,
      text,
      source,
    })),
    critical_comments: analysis.critical_comments.map(
      ({ comment_id, claim_id, stance, paraphrase, explanation }) => ({
        comment_id,
        claim_id,
        stance,
        paraphrase,
        explanation,
      }),
    ),
    supportive_comments: analysis.supportive_comments.map(
      ({ comment_id, claim_id, stance, paraphrase, explanation }) => ({
        comment_id,
        claim_id,
        stance,
        paraphrase,
        explanation,
      }),
    ),
    topics: analysis.topics.map(({ key, title, summary, comment_ids }) => ({
      key,
      title,
      summary,
      comment_ids: [...comment_ids],
    })),
  };
}

// Keep the public contract independent of internal query fields and diagnostics.
export function publicStory(story: PublicStory, includeDiscussion = false) {
  const image = canonicalArticleImage(story);
  return {
    hn_id: String(story.hn_id),
    title: story.title,
    category: story.category ?? null,
    url: story.url,
    points: story.points,
    comment_count: story.comment_count,
    date_added: story.date_added.toISOString(),
    image_url: image?.url ?? null,
    image_status: image ? "ready" : null,
    image_width: image?.width ?? null,
    image_height: image?.height ?? null,
    image_mime_type: image?.mimeType ?? null,
    summary: story.summary
      ? {
          article_summary: story.summary.article_summary,
          discussion_summary: story.summary.discussion_summary,
          overall_takeaway: story.summary.overall_takeaway,
          ...(includeDiscussion ? { discussion_analysis: publicDiscussion(story.summary) } : {}),
        }
      : null,
  };
}

// This additive feed contract contains only fields already rendered on ranked cards.
// Cards use the two latest valid observations for their movement badge.
// Keep it separate from the long-lived public detail/list schemas above.
export function publicReadyStory(
  story: Story & { rank_history: { observed_at: string; rank: number }[] },
) {
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
    rank_history: story.rank_history
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

export type PublicReadyStory = ReturnType<typeof publicReadyStory>;
export type PublicReadyStoryPage = {
  stories: PublicReadyStory[];
  pagination: ReadyStoryPage["pagination"];
};

export function readyStoriesHandler(data: {
  getReadyStoryPage: (input: { cursor?: string; pageSize?: number }) => Promise<ReadyStoryPage>;
}) {
  return async (request: Request) => {
    const url = new URL(request.url);
    const allowed = new Set(["cursor", "pageSize"]);
    if (
      [...url.searchParams.keys()].some((key) => !allowed.has(key)) ||
      [...url.searchParams.keys()].some((key) => url.searchParams.getAll(key).length !== 1)
    )
      return Response.json(
        { error: "Invalid story continuation", code: "invalid_cursor" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const pageSizeValue = url.searchParams.get("pageSize");
    const pageSize =
      pageSizeValue === null
        ? undefined
        : /^[1-9][0-9]*$/.test(pageSizeValue)
          ? Number(pageSizeValue)
          : Number.NaN;
    try {
      const page = await data.getReadyStoryPage({ cursor, pageSize });
      const response: PublicReadyStoryPage = {
        stories: page.stories.map(publicReadyStory),
        pagination: page.pagination,
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

export function storiesHandlers(data: {
  getLeaderboard: () => Promise<{ stories: Story[]; ingestion: Date | null }>;
  getStory: (id: string) => Promise<PublicStory | null>;
}) {
  const unavailable = () =>
    Response.json(
      { error: "Stories are temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
    );
  return {
    async list() {
      try {
        const { stories, ingestion } = await data.getLeaderboard();
        return Response.json({
          stories: stories.map((story) => publicStory(story)),
          ingestion: ingestion?.toISOString() ?? null,
        });
      } catch {
        return unavailable();
      }
    },
    async detail(id: string) {
      if (!validStoryId(id)) {
        return Response.json(
          { error: "Invalid story ID" },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }
      try {
        const story = await data.getStory(id);
        return story
          ? Response.json(publicStory(story, true), {
              headers: { "Cache-Control": PUBLIC_CACHE_CONTROL },
            })
          : Response.json(
              { error: "Story not found" },
              { status: 404, headers: { "Cache-Control": NEGATIVE_CACHE_CONTROL } },
            );
      } catch {
        return unavailable();
      }
    },
  };
}

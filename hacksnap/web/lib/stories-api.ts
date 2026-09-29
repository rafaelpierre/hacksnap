import type { Story } from "./data";
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

import type { Story, Summary } from "./data";
import type { DiscussionFields } from "./discussion-analysis";
import { storyImageProjection } from "./story-projection";

export type PublicStory = Pick<
  Story,
  | "hn_id"
  | "title"
  | "category"
  | "url"
  | "points"
  | "comment_count"
  | "date_added"
  | "image_url"
  | "image_status"
  | "image_width"
  | "image_height"
  | "image_mime_type"
> & {
  summary:
    | (Pick<Summary, "article_summary" | "discussion_summary" | "overall_takeaway"> &
        DiscussionFields)
    | null;
};

export const validStoryId = (id: string) => /^[1-9][0-9]{0,14}$/.test(id);

// Only the public contract, looked up by the two existing primary keys.
export const publicStorySQL = (
  hasDiscussion = true,
  hasImages = true,
) => `SELECT t.hn_id, t.title, t.category, t.url,
  t.points, t.comment_count, t.date_added, ${storyImageProjection(hasImages)},
  CASE WHEN s.story_id IS NULL THEN NULL ELSE json_build_object(
    'article_summary', s.article_summary,
    'discussion_summary', s.discussion_summary,
    'overall_takeaway', s.overall_takeaway,
    'discussion_analysis', ${hasDiscussion ? "s.discussion_analysis" : "NULL"},
    'discussion_analyzed_at', ${hasDiscussion ? "s.discussion_analyzed_at" : "NULL"},
    'discussion_analysis_coverage', ${hasDiscussion ? "s.discussion_analysis_coverage" : "NULL"}
  ) END AS summary
  FROM hacker_news_threads t
  LEFT JOIN hacksnap_summaries s ON s.story_id = t.hn_id
  WHERE t.hn_id = $1`;

export const PUBLIC_CACHE_CONTROL = "public, max-age=0, s-maxage=300";
export const NEGATIVE_CACHE_CONTROL = "public, max-age=0, s-maxage=60";

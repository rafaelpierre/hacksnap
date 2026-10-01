// Only columns granted to hacksnap_reader belong in these projections.
// Cards render only a takeaway and sentiment. No discussion analysis JSON is
// extracted or retained in their database result or server cache.

const storedImageFields = `t.image_url, t.image_status, t.image_width, t.image_height,
  t.image_mime_type`;
const unavailableImageFields = `NULL::text AS image_url, NULL::text AS image_status,
  NULL::integer AS image_width, NULL::integer AS image_height, NULL::text AS image_mime_type`;

export function imageProjection(available: boolean): string {
  return available ? storedImageFields : unavailableImageFields;
}

const fields = (
  summaryFields: string,
  analysis: string | null,
  analyzedAt = "s.discussion_analyzed_at",
  coverage = "s.discussion_analysis_coverage",
  imageFields = storedImageFields,
) => `t.hn_id, t.title, t.url, t.points, t.comment_count, t.date_added, t.category, ${imageFields},
  CASE WHEN s.story_id IS NULL THEN NULL ELSE json_build_object(
    ${summaryFields}${
      analysis
        ? `, ${analysis},
    'discussion_analyzed_at', ${analyzedAt},
    'discussion_analysis_coverage', ${coverage}`
        : ""
    }
  ) END AS summary`;

const cardSummary = `'overall_takeaway', s.overall_takeaway, 'sentiment', s.sentiment,
    'source_coverage', s.source_coverage`;
const articleSummary = `'article_summary', s.article_summary, 'article_key_points', s.article_key_points,
    'discussion_summary', s.discussion_summary, 'discussion_points', s.discussion_points,
    'sentiment', s.sentiment, 'overall_takeaway', s.overall_takeaway, 'generated_at', s.generated_at,
    'model', s.model, 'source_coverage', s.source_coverage`;
const exportSummary = `'article_summary', s.article_summary,
    'discussion_summary', s.discussion_summary, 'overall_takeaway', s.overall_takeaway,
    'sentiment', s.sentiment, 'source_coverage', s.source_coverage`;

export const feedFields = fields(cardSummary, null);
export const feedFieldsWithoutImages = fields(
  cardSummary,
  null,
  "NULL",
  "NULL",
  unavailableImageFields,
);
export const storyFields = fields(articleSummary, "'discussion_analysis', s.discussion_analysis");
export const storyFieldsWithoutImages = fields(
  articleSummary,
  "'discussion_analysis', s.discussion_analysis",
  "s.discussion_analyzed_at",
  "s.discussion_analysis_coverage",
  unavailableImageFields,
);
export const exportFields = fields(exportSummary, null);
export const exportFieldsWithoutImages = fields(
  exportSummary,
  null,
  "NULL",
  "NULL",
  unavailableImageFields,
);

// Resolve the same relation as the story queries and check SELECT specifically.
// Column existence alone is insufficient during a partially applied rollout.
export const discussionColumnsSQL = `SELECT count(*) = 3 AS available
  FROM pg_attribute
  WHERE attrelid = 'hacksnap_summaries'::regclass
    AND attname IN ('discussion_analysis', 'discussion_analyzed_at', 'discussion_analysis_coverage')
    AND NOT attisdropped
    AND has_column_privilege(attrelid, attname, 'SELECT')`;

// The reader grant can land separately from the additive image migration.
export const imageColumnsSQL = `SELECT count(*) = 5 AS available
  FROM pg_attribute
  WHERE attrelid = 'hacker_news_threads'::regclass
    AND attname IN ('image_url', 'image_status', 'image_width', 'image_height', 'image_mime_type')
    AND NOT attisdropped
    AND has_column_privilege(attrelid, attname, 'SELECT')`;

export const legacyFeedFields = feedFields;
export const legacyStoryFields = fields(
  articleSummary,
  "'discussion_analysis', NULL",
  "NULL",
  "NULL",
);
export const legacyFeedFieldsWithoutImages = feedFieldsWithoutImages;
export const legacyStoryFieldsWithoutImages = fields(
  articleSummary,
  "'discussion_analysis', NULL",
  "NULL",
  "NULL",
  unavailableImageFields,
);

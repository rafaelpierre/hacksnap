// Only columns granted to hacksnap_reader belong in these projections.
// Cards retain a bounded excerpt, never the full discussion analysis JSON.

// Source type is used only to filter; provenance stays out of public results.
const storedImageFields = [
  "image_url",
  "image_status",
  "image_width",
  "image_height",
  "image_mime_type",
]
  .map(
    (field) =>
      `CASE WHEN t.image_source_type IN ('og', 'twitter', 'json_ld') THEN t.${field} ELSE NULL END AS ${field}`,
  )
  .join(", ");
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
const cardDiscussion = `, 'discussion_preview', CASE
  WHEN s.discussion_analysis->>'status' = 'available' THEN (
    SELECT left(string_agg(preview.text, ' ' ORDER BY preview.position), 440)
    FROM (
      SELECT btrim(topic->>'summary') AS text, position
      FROM jsonb_array_elements(CASE
        WHEN jsonb_typeof(s.discussion_analysis->'topics') = 'array'
        THEN s.discussion_analysis->'topics' ELSE '[]'::jsonb END)
        WITH ORDINALITY AS topics(topic, position)
      WHERE jsonb_typeof(topic->'summary') = 'string'
        AND topic->>'summary' ~ '[^[:space:]]'
      ORDER BY position
      LIMIT 2
    ) preview
  ) ELSE NULL END`;
const articleSummary = `'article_summary', s.article_summary, 'article_key_points', s.article_key_points,
    'discussion_summary', s.discussion_summary, 'discussion_points', s.discussion_points,
    'sentiment', s.sentiment, 'overall_takeaway', s.overall_takeaway, 'generated_at', s.generated_at,
    'model', s.model, 'source_coverage', s.source_coverage`;
const exportSummary = `'article_summary', s.article_summary,
    'discussion_summary', s.discussion_summary, 'overall_takeaway', s.overall_takeaway,
    'sentiment', s.sentiment, 'source_coverage', s.source_coverage`;

export const feedFields = fields(cardSummary + cardDiscussion, null);
export const feedFieldsWithoutImages = fields(
  cardSummary + cardDiscussion,
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
export const imageColumnsSQL = `SELECT count(*) = 6 AS available
  FROM pg_attribute
  WHERE attrelid = 'hacker_news_threads'::regclass
    AND attname IN ('image_url', 'image_status', 'image_width', 'image_height', 'image_mime_type', 'image_source_type')
    AND NOT attisdropped
    AND has_column_privilege(attrelid, attname, 'SELECT')`;

export const legacyFeedFields = fields(cardSummary, null);
export const legacyStoryFields = fields(
  articleSummary,
  "'discussion_analysis', NULL",
  "NULL",
  "NULL",
);
export const legacyFeedFieldsWithoutImages = fields(
  cardSummary,
  null,
  "NULL",
  "NULL",
  unavailableImageFields,
);
export const legacyStoryFieldsWithoutImages = fields(
  articleSummary,
  "'discussion_analysis', NULL",
  "NULL",
  "NULL",
  unavailableImageFields,
);

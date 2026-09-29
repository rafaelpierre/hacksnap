// Only columns granted to hacksnap_reader belong in these projections.
// Preview aggregation happens in SQL: full highlights never enter feed payloads.
const preview = `CASE WHEN s.discussion_analysis IS NULL THEN NULL ELSE json_build_object(
  'status', s.discussion_analysis ->> 'status',
  'topics', COALESCE((SELECT json_agg(json_build_object(
    'key', topic ->> 'key', 'title', topic ->> 'title', 'summary', topic ->> 'summary'
  ) ORDER BY position) FROM jsonb_array_elements(s.discussion_analysis -> 'topics')
    WITH ORDINALITY AS topics(topic, position)), '[]'::json),
  'selected_evidence', json_build_object(
    'critical', jsonb_array_length(s.discussion_analysis -> 'critical_comments'),
    'supportive', jsonb_array_length(s.discussion_analysis -> 'supportive_comments')
  )
) END`;

const storedImageFields = `t.image_url, t.image_status, t.image_width, t.image_height,
  t.image_mime_type`;
const unavailableImageFields = `NULL::text AS image_url, NULL::text AS image_status,
  NULL::integer AS image_width, NULL::integer AS image_height, NULL::text AS image_mime_type`;

export function imageProjection(available: boolean): string {
  return available ? storedImageFields : unavailableImageFields;
}

const fields = (
  analysis: string,
  analyzedAt = "s.discussion_analyzed_at",
  coverage = "s.discussion_analysis_coverage",
  imageFields = storedImageFields,
) => `t.hn_id, t.title, t.url, t.points, t.comment_count, t.date_added, t.category, ${imageFields},
  CASE WHEN s.story_id IS NULL THEN NULL ELSE json_build_object(
    'article_summary', s.article_summary, 'article_key_points', s.article_key_points,
    'discussion_summary', s.discussion_summary, 'discussion_points', s.discussion_points,
    'sentiment', s.sentiment, 'overall_takeaway', s.overall_takeaway, 'generated_at', s.generated_at,
    'model', s.model, 'source_coverage', s.source_coverage,
    ${analysis},
    'discussion_analyzed_at', ${analyzedAt},
    'discussion_analysis_coverage', ${coverage}
  ) END AS summary`;

export const feedFields = fields(`'discussion_analysis_preview', ${preview}`);
export const storyFields = fields("'discussion_analysis', s.discussion_analysis");
export const feedFieldsWithoutImages = fields(
  `'discussion_analysis_preview', ${preview}`,
  "s.discussion_analyzed_at",
  "s.discussion_analysis_coverage",
  unavailableImageFields,
);
export const storyFieldsWithoutImages = fields(
  "'discussion_analysis', s.discussion_analysis",
  "s.discussion_analyzed_at",
  "s.discussion_analysis_coverage",
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

export const legacyFeedFields = fields("'discussion_analysis_preview', NULL", "NULL", "NULL");
export const legacyStoryFields = fields("'discussion_analysis', NULL", "NULL", "NULL");
export const legacyFeedFieldsWithoutImages = fields(
  "'discussion_analysis_preview', NULL",
  "NULL",
  "NULL",
  unavailableImageFields,
);
export const legacyStoryFieldsWithoutImages = fields(
  "'discussion_analysis', NULL",
  "NULL",
  "NULL",
  unavailableImageFields,
);

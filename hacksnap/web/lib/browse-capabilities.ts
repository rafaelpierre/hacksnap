// One catalog round trip per browse-list cache miss. Each check retains the
// existing column-existence and reader SELECT-grant requirement, so partially
// applied migrations keep using null/legacy projections until the next miss.
export const browseCapabilitiesSQL = `SELECT
  (SELECT count(*) = 3 FROM pg_attribute
    WHERE attrelid = 'hacksnap_summaries'::regclass
      AND attname IN ('discussion_analysis', 'discussion_analyzed_at', 'discussion_analysis_coverage')
      AND NOT attisdropped AND has_column_privilege(attrelid, attname, 'SELECT')) AS discussion_available,
  (SELECT count(*) = 5 FROM pg_attribute
    WHERE attrelid = 'hacker_news_threads'::regclass
      AND attname IN ('image_url', 'image_status', 'image_width', 'image_height', 'image_mime_type')
      AND NOT attisdropped AND has_column_privilege(attrelid, attname, 'SELECT')) AS images_available,
  (SELECT EXISTS (SELECT 1 FROM pg_attribute
    WHERE attrelid = 'hacker_news_threads'::regclass AND attname = 'story_slug'
      AND NOT attisdropped AND has_column_privilege(attrelid, attname, 'SELECT'))) AS slug_available`;

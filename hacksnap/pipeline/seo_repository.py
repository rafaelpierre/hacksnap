"""SEO persistence shares the worker's existing connection safeguards."""

from psycopg.types.json import Jsonb

from .supabase import Repository


class SeoRepository(Repository):
    def seo_candidates(self, generation_version, *, limit=50, after_id=None):
        if not 1 <= limit <= 50 or (after_id is not None and after_id < 0):
            raise ValueError("SEO batches require limit 1-50 and a nonnegative cursor")
        with self._connect() as connection:
            return connection.execute("""
                SELECT s.story_id, t.title AS original_title, s.title, s.article_summary,
                    s.article_key_points, s.overall_takeaway,
                    s.discussion_points, s.source_coverage, s.seo_metadata, s.seo_input_version
                FROM hacksnap_summaries s JOIN hacker_news_threads t ON t.hn_id = s.story_id
                WHERE s.overall_takeaway ~ '[^[:space:]]'
                  AND COALESCE(s.source_coverage->>'article_status', '') <> 'unavailable'
                  AND NOT EXISTS (SELECT 1 FROM hacksnap_fetch_failures f
                      WHERE f.story_id = t.hn_id AND f.article_url = t.url)
                  AND (s.seo_pending OR (%(after_id)s::bigint IS NOT NULL AND
                       s.seo_metadata->>'generation_version' IS DISTINCT FROM %(version)s))
                  AND (s.seo_attempted_at IS NULL OR
                       s.seo_attempted_at < clock_timestamp() - interval '1 hour')
                  AND (%(after_id)s::bigint IS NULL OR s.story_id > %(after_id)s)
                ORDER BY CASE WHEN %(after_id)s::bigint IS NOT NULL THEN s.story_id END,
                    s.seo_attempted_at NULLS FIRST, s.story_id DESC
                LIMIT %(limit)s
            """, {"version": generation_version, "limit": limit, "after_id": after_id}).fetchall()

    def claim_seo(self, row):
        with self._connect() as connection:
            return connection.execute("""
                UPDATE hacksnap_summaries SET seo_attempted_at = clock_timestamp()
                WHERE story_id = %s AND seo_input_version = %s
                  AND (seo_attempted_at IS NULL OR
                       seo_attempted_at < clock_timestamp() - interval '1 hour')
            """, (row["story_id"], row["seo_input_version"])).rowcount == 1

    def save_seo(self, row, result, provenance):
        with self._connect() as connection:
            return connection.execute("""
                UPDATE hacksnap_summaries
                SET seo_title = %s, seo_description = %s, seo_metadata = %s, seo_pending = false
                WHERE story_id = %s AND seo_input_version = %s
            """, (result.seo_title, result.seo_description, Jsonb(provenance),
                  row["story_id"], row["seo_input_version"])).rowcount == 1

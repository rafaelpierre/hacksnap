"""Select published summaries directly and save SEO copy without queues or triggers."""

from psycopg.types.json import Jsonb

from .supabase import Repository


class SeoRepository(Repository):
    def seo_candidates(self, *, limit=50, after_id=None):
        if not 1 <= limit <= 50 or (after_id is not None and after_id < 0):
            raise ValueError("SEO batches require limit 1-50 and a nonnegative cursor")
        with self._connect() as connection:
            return connection.execute("""
                SELECT s.story_id, t.title AS original_title, s.title, s.article_summary,
                    s.article_key_points, s.overall_takeaway,
                    s.discussion_points, s.source_coverage, s.seo_metadata
                FROM hacksnap_summaries s JOIN hacker_news_threads t ON t.hn_id = s.story_id
                WHERE s.overall_takeaway ~ '[^[:space:]]'
                  AND COALESCE(s.source_coverage->>'article_status', '') <> 'unavailable'
                  AND NOT EXISTS (SELECT 1 FROM hacksnap_fetch_failures f
                      WHERE f.story_id = t.hn_id AND f.article_url = t.url)
                  AND (%(after_id)s::bigint IS NULL OR s.story_id > %(after_id)s)
                ORDER BY CASE WHEN %(after_id)s::bigint IS NOT NULL THEN s.story_id END,
                    s.generated_at DESC, s.story_id DESC
                LIMIT %(limit)s
            """, {"limit": limit, "after_id": after_id}).fetchall()

    def save_seo(self, row, result, provenance):
        # Compare input fields directly instead of maintaining version triggers.
        def json_value(value):
            return None if value is None else Jsonb(value)

        params = {
            "id": row["story_id"], "original_title": row["original_title"],
            "title": row.get("title"), "article_summary": row.get("article_summary"),
            "article_key_points": json_value(row.get("article_key_points")),
            "overall_takeaway": row["overall_takeaway"],
            "discussion_points": json_value(row.get("discussion_points")),
            "article_status": (row.get("source_coverage") or {}).get("article_status"),
            "previous_metadata": json_value(row.get("seo_metadata")),
            "seo_title": result.seo_title, "seo_description": result.seo_description,
            "metadata": Jsonb(provenance),
        }
        with self._connect() as connection:
            return connection.execute("""
                UPDATE hacksnap_summaries s
                SET seo_title = %(seo_title)s, seo_description = %(seo_description)s,
                    seo_metadata = %(metadata)s
                FROM hacker_news_threads t
                WHERE s.story_id = %(id)s AND t.hn_id = s.story_id
                  AND t.title IS NOT DISTINCT FROM %(original_title)s
                  AND s.title IS NOT DISTINCT FROM %(title)s
                  AND s.article_summary IS NOT DISTINCT FROM %(article_summary)s
                  AND s.article_key_points IS NOT DISTINCT FROM %(article_key_points)s::jsonb
                  AND s.overall_takeaway IS NOT DISTINCT FROM %(overall_takeaway)s
                  AND s.discussion_points IS NOT DISTINCT FROM %(discussion_points)s::jsonb
                  AND s.source_coverage->>'article_status' IS NOT DISTINCT FROM %(article_status)s
                  AND s.seo_metadata IS NOT DISTINCT FROM %(previous_metadata)s::jsonb
                  AND NOT EXISTS (SELECT 1 FROM hacksnap_fetch_failures f
                      WHERE f.story_id = t.hn_id AND f.article_url = t.url)
            """, params).rowcount == 1

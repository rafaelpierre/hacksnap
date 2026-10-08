import type { StoryIdentity } from "./story-domain";

export type PopularStory = Pick<StoryIdentity, "hn_id" | "title" | "story_slug"> & {
  views: string;
};

export type PopularPeriod = "last-7-days" | "all-time";

export const popularityAvailableSQL = `SELECT
  count(*) = 3 AND COALESCE(bool_and(has_column_privilege(c.oid, field, 'SELECT')), false)
    AS available
  FROM pg_class c
  CROSS JOIN unnest(ARRAY['story_id', 'historical_views', 'story_views']) AS field
  WHERE c.oid = to_regclass('public.hacksnap_story_popularity')`;

export const weeklyPopularityAvailableSQL = `SELECT
  count(*) = 3 AND COALESCE(bool_and(has_column_privilege(c.oid, field, 'SELECT')), false)
    AS available
  FROM pg_class c
  CROSS JOIN unnest(ARRAY['story_id', 'kind', 'received_at']) AS field
  WHERE c.oid = to_regclass('public.hacksnap_popularity_events')`;

export function popularStoriesSQL(slug: string, period: PopularPeriod = "all-time"): string {
  if (period === "last-7-days")
    return `WITH recent_views AS (
      SELECT story_id, count(*) AS views
      FROM public.hacksnap_popularity_events
      WHERE kind = 'view'
        AND received_at >= CURRENT_TIMESTAMP - INTERVAL '168 hours'
        AND received_at <= CURRENT_TIMESTAMP
      GROUP BY story_id
    )
    SELECT t.hn_id::text AS hn_id, t.title, ${slug}, p.views::text AS views
    FROM recent_views p
    JOIN public.hacker_news_threads t ON t.hn_id = p.story_id
    JOIN public.hacksnap_summaries s ON s.story_id = t.hn_id
    WHERE s.overall_takeaway ~ '[^[:space:]]'
      AND t.hn_id BETWEEN 1 AND 999999999999999
      AND t.date_added <= CURRENT_TIMESTAMP
    ORDER BY p.views DESC, t.hn_id DESC
    LIMIT 5`;
  return `SELECT t.hn_id::text AS hn_id, t.title, ${slug},
    (p.historical_views::numeric + p.story_views::numeric)::text AS views
    FROM public.hacksnap_story_popularity p
    JOIN public.hacker_news_threads t ON t.hn_id = p.story_id
    JOIN public.hacksnap_summaries s ON s.story_id = t.hn_id
    WHERE s.overall_takeaway ~ '[^[:space:]]'
      AND t.hn_id BETWEEN 1 AND 999999999999999
      AND t.date_added <= CURRENT_TIMESTAMP
      AND p.historical_views::numeric + p.story_views::numeric > 0
    ORDER BY p.historical_views::numeric + p.story_views::numeric DESC, t.hn_id DESC
    LIMIT 5`;
}

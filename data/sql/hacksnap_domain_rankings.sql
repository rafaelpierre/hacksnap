-- Longest run of consecutive recorded Hacksnap batches with any story in the top 10.
-- Duration spans first to last observation; one observation has zero duration.
-- Missing domain in a recorded batch breaks the run. Unrecorded gaps are unknown.
-- Domains that never reached the top 10 are omitted.
CREATE OR REPLACE FUNCTION public.rank_hn_domains_by_top10_streak()
RETURNS TABLE (domain text, longest_top10_streak interval, streak_start timestamptz, streak_end timestamptz, observations bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH hosts AS (
    SELECT hn_id, rtrim(substring(lower(trim(url))
      FROM '^(?:https?://|//)(?:[^/@]+@)?(\[[^]]+\]|[^/:?#]+)'), '.') AS domain
    FROM public.hacker_news_threads
  ), batches AS (
    SELECT observed_at, row_number() OVER (ORDER BY observed_at) AS batch
    FROM (SELECT DISTINCT observed_at FROM public.hacksnap_rank_history) times
  ), presence AS (
    SELECT DISTINCT h.domain, b.observed_at, b.batch
    FROM public.hacksnap_rank_history r
    JOIN hosts h USING (hn_id)
    JOIN batches b USING (observed_at)
    WHERE h.domain IS NOT NULL AND r.rank <= 10
  ), islands AS (
    SELECT *, batch - row_number() OVER (
      PARTITION BY domain ORDER BY batch
    ) AS streak_id
    FROM presence
  ), streaks AS (
    SELECT domain, min(observed_at) AS streak_start,
           max(observed_at) AS streak_end, count(*) AS observations
    FROM islands
    GROUP BY domain, streak_id
  ), picked AS (
    SELECT *, row_number() OVER (
      PARTITION BY domain
      ORDER BY streak_end - streak_start DESC, streak_end DESC
    ) AS choice
    FROM streaks
  )
  SELECT domain, streak_end - streak_start AS longest_top10_streak,
         streak_start, streak_end, observations
  FROM picked
  WHERE choice = 1
  ORDER BY longest_top10_streak DESC, domain;
$$;

-- Best recorded Hacksnap rank of any individual story; lower is better.
CREATE OR REPLACE FUNCTION public.rank_hn_domains_by_best_rank()
RETURNS TABLE (domain text, best_rank bigint, story_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH hosts AS (
    SELECT hn_id, rtrim(substring(lower(trim(url))
      FROM '^(?:https?://|//)(?:[^/@]+@)?(\[[^]]+\]|[^/:?#]+)'), '.') AS domain
    FROM public.hacker_news_threads
  )
  SELECT h.domain, min(r.rank)::bigint AS best_rank,
         count(DISTINCT r.hn_id) AS story_count
  FROM public.hacksnap_rank_history r
  JOIN hosts h USING (hn_id)
  WHERE h.domain IS NOT NULL
  GROUP BY h.domain
  ORDER BY best_rank, h.domain;
$$;

-- Average recorded rank per story, then equal-weight average across stories.
-- Includes all recorded ranks, including ranks below the top 10.
CREATE OR REPLACE FUNCTION public.rank_hn_domains_by_average_rank()
RETURNS TABLE (domain text, average_rank numeric, story_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH hosts AS (
    SELECT hn_id, rtrim(substring(lower(trim(url))
      FROM '^(?:https?://|//)(?:[^/@]+@)?(\[[^]]+\]|[^/:?#]+)'), '.') AS domain
    FROM public.hacker_news_threads
  ), story_averages AS (
    SELECT h.domain, r.hn_id, avg(r.rank) AS average_rank
    FROM public.hacksnap_rank_history r
    JOIN hosts h USING (hn_id)
    WHERE h.domain IS NOT NULL
    GROUP BY h.domain, r.hn_id
  )
  SELECT domain, avg(average_rank) AS average_rank, count(*) AS story_count
  FROM story_averages
  GROUP BY domain
  ORDER BY average_rank, domain;
$$;

-- Issue #135: read-only inventory. Run in a read-only transaction on the deployed
-- database, record the UTC snapshot time and deployed schema version, and save
-- outputs outside this repository. No production data was queried for this draft.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';

-- Current eligible inventory: only rows without a summary can enter initial
-- summarization. Existing blank summaries need repair, even with retained source.
WITH inventory AS (
  SELECT r.rank, r.hn_id, t.date_added, c.hn_id IS NOT NULL AS source_retained,
         s.story_id IS NOT NULL AS has_summary,
         COALESCE(s.overall_takeaway ~ '[^[:space:]]', false) AS ready
  FROM hacksnap_ranked_stories r
  JOIN hacker_news_threads t USING (hn_id)
  LEFT JOIN hn_thread_contents c USING (hn_id)
  LEFT JOIN hacksnap_summaries s ON s.story_id = r.hn_id
), bands AS (
  SELECT CASE WHEN rank <= 10 THEN '001-010'
              WHEN rank <= 50 THEN '011-050'
              WHEN rank <= 100 THEN '051-100'
              ELSE '101+' END AS rank_band,
         *
  FROM inventory
)
SELECT rank_band, count(*) AS eligible_sources,
       count(*) FILTER (WHERE ready) AS usable_briefs,
       count(*) FILTER (WHERE NOT has_summary AND source_retained) AS initial_summary_backlog_with_source,
       count(*) FILTER (WHERE NOT has_summary AND NOT source_retained) AS initial_summary_backlog_without_source,
       count(*) FILTER (WHERE has_summary AND NOT ready) AS existing_summary_needs_repair,
       percentile_cont(0.5) WITHIN GROUP (
         ORDER BY EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - date_added)) / 3600
       ) FILTER (WHERE NOT has_summary AND source_retained) AS initial_summary_backlog_age_p50_hours
FROM bands GROUP BY rank_band ORDER BY rank_band;

-- Save this entire result after each scheduled run, keyed by (captured_at_utc,
-- hn_id). Derive new ready-state transitions and bounded lag externally. Neither
-- generated_at nor updated_at is a first-ready timestamp: summary upserts reset
-- generated_at, and refreshes can change updated_at.
SELECT CURRENT_TIMESTAMP AS captured_at_utc, r.hn_id, r.rank, t.date_added,
       c.hn_id IS NOT NULL AS source_retained,
       s.story_id IS NOT NULL AS has_summary,
       COALESCE(s.overall_takeaway ~ '[^[:space:]]', false) AS ready
FROM hacksnap_ranked_stories r
JOIN hacker_news_threads t USING (hn_id)
LEFT JOIN hn_thread_contents c USING (hn_id)
LEFT JOIN hacksnap_summaries s ON s.story_id = r.hn_id
ORDER BY r.rank;

COMMIT;

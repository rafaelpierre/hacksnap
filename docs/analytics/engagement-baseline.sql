-- GA4 BigQuery export. Replace PROJECT.analytics_PROPERTY with the actual dataset.
-- Run only after cohort_end + 30 days of daily export are available.
DECLARE cohort_start DATE DEFAULT DATE '2026-10-01';
DECLARE cohort_end DATE DEFAULT DATE '2026-10-14';

CREATE TEMP TABLE journey AS
SELECT
  PARSE_DATE('%Y%m%d', event_date) AS day,
  TIMESTAMP_MICROS(event_timestamp) AS occurred_at,
  event_name,
  user_pseudo_id,
  IF(user_pseudo_id IS NULL OR ga_session_id IS NULL, NULL,
    CONCAT(user_pseudo_id, ':', CAST(ga_session_id AS STRING))) AS session_key,
  device.category AS device_category,
  COALESCE(traffic_source.source, '(unknown)') AS first_acquisition_source,
  story_id,
  target_story_id,
  placement,
  destination,
  copy_kind
FROM (
  SELECT *,
    (SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'ga_session_id') AS ga_session_id,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'story_id') AS story_id,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'target_story_id') AS target_story_id,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'placement') AS placement,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'destination') AS destination,
    (SELECT value.string_value FROM UNNEST(event_params) WHERE key = 'copy_kind') AS copy_kind
  FROM `PROJECT.analytics_PROPERTY.events_*`
  WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', cohort_start)
    AND FORMAT_DATE('%Y%m%d', DATE_ADD(cohort_end, INTERVAL 30 DAY))
    AND COALESCE((SELECT value.int_value FROM UNNEST(event_params) WHERE key = 'contract_version'), 1) = 1
    AND event_name IN ('story_view', 'recommendation_exposure', 'recommendation_click',
      'share_menu_open', 'share_destination_select', 'share_copy_success',
      'share_copy_failure', 'share_manual_fallback', 'return_visit')
);

-- 1. Second-story visit rate: sessions with 2+ distinct stories / sessions with 1+ story.
WITH sessions AS (
  SELECT session_key, device_category, first_acquisition_source,
    COUNT(DISTINCT story_id) AS stories
  FROM journey
  WHERE event_name = 'story_view' AND day BETWEEN cohort_start AND cohort_end
    AND session_key IS NOT NULL
  GROUP BY 1, 2, 3
)
SELECT device_category, first_acquisition_source,
  COUNT(*) AS reading_sessions,
  COUNTIF(stories >= 2) AS second_story_sessions,
  SAFE_DIVIDE(COUNTIF(stories >= 2), COUNT(*)) AS second_story_rate
FROM sessions GROUP BY 1, 2 ORDER BY reading_sessions DESC;

-- 2. Recommendation CTR: visible story-pair exposures clicked in the same GA session.
-- Each pair contributes at most once; clicks without recorded exposure are excluded.
WITH exposures AS (
  SELECT DISTINCT session_key, story_id, target_story_id, device_category,
    first_acquisition_source
  FROM journey
  WHERE event_name = 'recommendation_exposure' AND day BETWEEN cohort_start AND cohort_end
    AND session_key IS NOT NULL AND story_id IS NOT NULL AND target_story_id IS NOT NULL
), clicks AS (
  SELECT DISTINCT session_key, story_id, target_story_id
  FROM journey WHERE event_name = 'recommendation_click'
)
SELECT e.device_category, e.first_acquisition_source,
  COUNT(*) AS recommendation_exposures,
  COUNTIF(c.session_key IS NOT NULL) AS clicked_exposures,
  SAFE_DIVIDE(COUNTIF(c.session_key IS NOT NULL), COUNT(*)) AS recommendation_ctr
FROM exposures e LEFT JOIN clicks c USING (session_key, story_id, target_story_id)
GROUP BY 1, 2 ORDER BY recommendation_exposures DESC;

-- 3. Share outcomes: count each action separately. A destination selection is
-- only an outbound intent; neither it nor manual fallback proves publication/copy.
SELECT device_category, first_acquisition_source, event_name, placement,
  COALESCE(destination, copy_kind, '(none)') AS action_detail,
  COUNT(*) AS actions, COUNT(DISTINCT session_key) AS sessions
FROM journey
WHERE event_name LIKE 'share_%' AND day BETWEEN cohort_start AND cohort_end
GROUP BY 1, 2, 3, 4, 5 ORDER BY 1, 2, 3, 4, 5;

-- 4. Observed return rate: readers in the cohort with a return_visit event
-- after their first story and within 30 days / readers in the full cohort.
-- Run after the complete follow-up window; GA user_pseudo_id is device/browser scoped.
WITH readers AS (
  SELECT user_pseudo_id, device_category, first_acquisition_source,
    MIN(occurred_at) AS first_story_at
  FROM journey
  WHERE event_name = 'story_view' AND day BETWEEN cohort_start AND cohort_end
    AND user_pseudo_id IS NOT NULL
  GROUP BY 1, 2, 3
), returns AS (
  SELECT DISTINCT r.user_pseudo_id, r.device_category, r.first_acquisition_source
  FROM readers r JOIN journey j ON j.user_pseudo_id = r.user_pseudo_id
    AND j.event_name = 'return_visit'
    AND j.occurred_at >= TIMESTAMP_ADD(r.first_story_at, INTERVAL 1 DAY)
    AND j.occurred_at <= TIMESTAMP_ADD(r.first_story_at, INTERVAL 30 DAY)
)
SELECT r.device_category, r.first_acquisition_source,
  COUNT(*) AS eligible_readers,
  COUNTIF(v.user_pseudo_id IS NOT NULL) AS returning_readers,
  SAFE_DIVIDE(COUNTIF(v.user_pseudo_id IS NOT NULL), COUNT(*)) AS observed_return_rate
FROM readers r LEFT JOIN returns v USING (user_pseudo_id, device_category, first_acquisition_source)
GROUP BY 1, 2 ORDER BY eligible_readers DESC;

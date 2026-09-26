-- BigQuery Standard SQL. Replace YOUR_PROJECT.YOUR_DATASET with the GA4 export.
-- Use completed daily tables. Set UTC boundaries; cohort_end is exclusive.
DECLARE cohort_start DATE DEFAULT DATE '2026-09-27';
DECLARE cohort_end DATE DEFAULT DATE '2026-10-11';
DECLARE observation_end DATE DEFAULT DATE '2026-10-18';
ASSERT observation_end >= DATE_ADD(cohort_end, INTERVAL 7 DAY) AS 'Return cohorts need seven days follow-up';
CREATE TEMP TABLE events AS
SELECT event_name, TIMESTAMP_MICROS(event_timestamp) AS ts, user_pseudo_id AS reader,
  (SELECT value.int_value FROM UNNEST(event_params) WHERE key='ga_session_id') AS session_id,
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key='visit_id') AS visit_id,
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key='story_id') AS story_id,
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key='target_story_id') AS target_id,
  (SELECT value.int_value FROM UNNEST(event_params) WHERE key='position') AS position,
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key='copy_kind') AS copy_kind,
  (SELECT value.string_value FROM UNNEST(event_params) WHERE key='destination') AS destination,
  device.category AS device, COALESCE(traffic_source.source, '(unknown)') AS acquisition_source
FROM `YOUR_PROJECT.YOUR_DATASET.events_*`
WHERE _TABLE_SUFFIX >= FORMAT_DATE('%Y%m%d', DATE_SUB(cohort_start, INTERVAL 1 DAY))
  AND _TABLE_SUFFIX <= FORMAT_DATE('%Y%m%d', observation_end)
  AND (SELECT value.int_value FROM UNNEST(event_params) WHERE key='contract_version') = 2;

-- Export lag and consent/identity exclusions: retain these counts with every report.
SELECT MIN(ts) first_event, MAX(ts) last_event, COUNT(*) events,
  COUNTIF(reader IS NULL) missing_reader, COUNTIF(session_id IS NULL) missing_session
FROM events;

-- Reading sessions: cohort by first observed story, exclude left-censored sessions.
WITH sessions AS (
 SELECT reader, session_id, MIN(ts) first_story, COUNT(DISTINCT story_id) stories,
   ARRAY_AGG(STRUCT(device, acquisition_source) ORDER BY ts LIMIT 1)[OFFSET(0)] cohort
 FROM events WHERE event_name='story_view' AND reader IS NOT NULL AND session_id IS NOT NULL
 GROUP BY reader, session_id
)
SELECT cohort.*, COUNT(*) reading_sessions, COUNTIF(stories >= 2) second_story_sessions,
  SAFE_DIVIDE(COUNTIF(stories >= 2), COUNT(*)) second_story_rate
FROM sessions WHERE DATE(first_story) >= cohort_start AND DATE(first_story) < cohort_end
GROUP BY cohort.device, cohort.acquisition_source;

-- One recommendation opportunity = visit/source/target/position; click requires exposure.
WITH opportunities AS (
 SELECT reader, visit_id, story_id, target_id, position, device, acquisition_source,
   COUNTIF(event_name='recommendation_exposure') > 0 exposed,
   COUNTIF(event_name='recommendation_click') > 0 clicked
 FROM events WHERE DATE(ts) >= cohort_start AND DATE(ts) < cohort_end
   AND event_name IN ('recommendation_exposure', 'recommendation_click')
 GROUP BY reader, visit_id, story_id, target_id, position, device, acquisition_source
)
SELECT device, acquisition_source, position, COUNTIF(exposed) exposures,
 COUNTIF(exposed AND clicked) clicked_exposures,
 SAFE_DIVIDE(COUNTIF(exposed AND clicked), COUNTIF(exposed)) recommendation_ctr
FROM opportunities GROUP BY device, acquisition_source, position;

-- Event counts include repeated intentional actions. No publication-success metric.
SELECT device, acquisition_source, copy_kind, destination, event_name, COUNT(*) actions
FROM events WHERE DATE(ts) >= cohort_start AND DATE(ts) < cohort_end
 AND event_name IN ('share_menu_open','share_destination_select','share_copy_attempt','share_copy_success','share_copy_failure','share_manual_fallback')
GROUP BY device, acquisition_source, copy_kind, destination, event_name;
SELECT device, acquisition_source, copy_kind,
 COUNTIF(event_name='share_copy_attempt') attempts,
 COUNTIF(event_name='share_copy_success') successes,
 COUNTIF(event_name='share_copy_failure') failures,
 SAFE_DIVIDE(COUNTIF(event_name='share_copy_success'),COUNTIF(event_name='share_copy_attempt')) copy_success_rate
FROM events WHERE DATE(ts) >= cohort_start AND DATE(ts) < cohort_end
 AND event_name IN ('share_copy_attempt','share_copy_success','share_copy_failure')
GROUP BY device, acquisition_source, copy_kind;
WITH visits AS (
 SELECT visit_id, device, acquisition_source,
 COUNTIF(event_name='share_menu_open') > 0 opened,
 COUNTIF(event_name='share_destination_select') > 0 selected
 FROM events WHERE DATE(ts) >= cohort_start AND DATE(ts) < cohort_end
 GROUP BY visit_id, device, acquisition_source
)
SELECT device, acquisition_source, COUNTIF(opened) menu_visits,
 COUNTIF(opened AND selected) destination_visits,
 SAFE_DIVIDE(COUNTIF(opened AND selected), COUNTIF(opened)) destination_selection_rate
FROM visits GROUP BY device, acquisition_source;

-- Seven-day return: a distinct GA session after the first observed cohort visit.
WITH firsts AS (
 SELECT reader, ARRAY_AGG(STRUCT(ts, session_id, device, acquisition_source) ORDER BY ts LIMIT 1)[OFFSET(0)] first
 FROM events WHERE event_name='reader_visit' AND reader IS NOT NULL AND session_id IS NOT NULL
   AND DATE(ts) >= cohort_start
 GROUP BY reader
), returns AS (
 SELECT f.reader, f.first,
 COUNTIF(e.session_id != f.first.session_id AND e.ts > f.first.ts
   AND e.ts <= TIMESTAMP_ADD(f.first.ts, INTERVAL 7 DAY)) > 0 returned
 FROM firsts f LEFT JOIN events e ON e.reader=f.reader AND e.event_name='reader_visit'
 WHERE DATE(f.first.ts) < cohort_end
 GROUP BY f.reader, f.first
)
SELECT first.device, first.acquisition_source, COUNT(*) eligible_readers,
 COUNTIF(returned) returning_readers, SAFE_DIVIDE(COUNTIF(returned),COUNT(*)) seven_day_return_rate
FROM returns GROUP BY first.device, first.acquisition_source;

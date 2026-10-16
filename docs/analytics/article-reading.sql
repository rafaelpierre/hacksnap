-- BigQuery Standard SQL. Replace YOUR_PROJECT.YOUR_DATASET; dates are examples.
-- Run on settled daily exports (allow 72 hours). cohort_end is exclusive, UTC.
DECLARE cohort_start DATE DEFAULT DATE '2026-10-17';
DECLARE cohort_end DATE DEFAULT DATE '2026-10-24';
CREATE TEMP FUNCTION str(params ANY TYPE, field STRING) AS
  ((SELECT value.string_value FROM UNNEST(params) WHERE key = field));
CREATE TEMP FUNCTION num(params ANY TYPE, field STRING) AS
  ((SELECT value.int_value FROM UNNEST(params) WHERE key = field));

CREATE TEMP TABLE events AS
SELECT event_name, TIMESTAMP_MICROS(event_timestamp) ts,
  user_pseudo_id reader, num(event_params, 'ga_session_id') session_id,
  str(event_params, 'visit_id') visit_id, str(event_params, 'story_id') story_id,
  num(event_params, 'reading_version') reading_version,
  str(event_params, 'content_revision') content_revision,
  str(event_params, 'layout_variant') layout_variant,
  str(event_params, 'copy_variant') copy_variant,
  str(event_params, 'category') category, str(event_params, 'summary_status') summary_status,
  str(event_params, 'section_id') section_id, str(event_params, 'section_type') section_type,
  num(event_params, 'section_position') section_position, num(event_params, 'section_words') section_words,
  num(event_params, 'visible_ms') visible_ms, num(event_params, 'active_ms') active_ms,
  num(event_params, 'checkpoint_sequence') checkpoint_sequence,
  str(event_params, 'last_section') last_section, str(event_params, 'furthest_section') furthest_section,
  str(event_params, 'checkpoint_reason') checkpoint_reason,
  str(event_params, 'action') action, str(event_params, 'source_kind') source_kind,
  device.category device, COALESCE(traffic_source.source, '(unknown)') first_user_source
FROM `YOUR_PROJECT.YOUR_DATASET.events_*`
WHERE _TABLE_SUFFIX BETWEEN FORMAT_DATE('%Y%m%d', cohort_start)
  AND FORMAT_DATE('%Y%m%d', DATE_ADD(cohort_end, INTERVAL 1 DAY))
  AND num(event_params, 'contract_version') = 2;

CREATE TEMP TABLE visits AS
SELECT * FROM events
WHERE event_name = 'article_reading_start' AND reading_version = 1
  AND DATE(ts) >= cohort_start AND DATE(ts) < cohort_end AND visit_id IS NOT NULL
QUALIFY ROW_NUMBER() OVER (PARTITION BY visit_id, content_revision ORDER BY ts) = 1;

CREATE TEMP TABLE sections AS
SELECT v.visit_id, v.story_id, v.content_revision, v.layout_variant, v.copy_variant,
  v.category, v.summary_status, v.device, v.first_user_source,
  e.section_id, e.section_type, MIN(e.section_position) section_position,
  MAX(e.section_words) section_words,
  COUNTIF(e.event_name = 'article_section_available') > 0 eligible,
  MIN(IF(e.event_name = 'article_section_view', e.ts, NULL)) exposed_at,
  COUNTIF(e.event_name = 'article_section_engaged') > 0 engaged,
  MAX(e.visible_ms) visible_ms,
  COUNTIF(e.event_name = 'article_theme_toggle' AND e.action = 'open') > 0 opened
FROM visits v JOIN events e
  ON e.visit_id = v.visit_id AND e.content_revision = v.content_revision AND e.reading_version = 1
WHERE e.section_id IS NOT NULL
GROUP BY v.visit_id, v.story_id, v.content_revision, v.layout_variant, v.copy_variant,
  v.category, v.summary_status, v.device, v.first_user_source, e.section_id, e.section_type;

-- Coverage first: missing checkpoints are unknown, not zero-second reads or confirmed exits.
SELECT COUNT(*) visits, COUNTIF(reader IS NULL) missing_reader,
  COUNTIF(session_id IS NULL) missing_session,
  COUNTIF(NOT EXISTS (
    SELECT 1 FROM events e WHERE e.visit_id = v.visit_id AND e.content_revision = v.content_revision
      AND e.event_name = 'article_reading_checkpoint'
  )) visits_without_checkpoint
FROM visits v;
SELECT COUNTIF(NOT eligible AND exposed_at IS NOT NULL) exposures_without_availability
FROM sections;

-- Section reach and sustained attention. Keep revision/variant cohorts separate.
-- Zero-duration and missing final flushes must not bias median dwell downward.
SELECT story_id, content_revision, layout_variant, copy_variant, category, summary_status,
  device, first_user_source, section_type, section_id,
  COUNT(*) eligible_visits, COUNTIF(exposed_at IS NOT NULL) exposed_visits,
  SAFE_DIVIDE(COUNTIF(exposed_at IS NOT NULL), COUNT(*)) reach_rate,
  SAFE_DIVIDE(COUNTIF(engaged AND exposed_at IS NOT NULL),
    COUNTIF(exposed_at IS NOT NULL)) engaged_given_exposure,
  COUNTIF(exposed_at IS NOT NULL AND visible_ms IS NULL) exposed_without_saved_time,
  APPROX_QUANTILES(IF(exposed_at IS NOT NULL, visible_ms, NULL), 100)[OFFSET(50)] median_visible_ms,
  MAX(section_words) section_words
FROM sections WHERE eligible
GROUP BY story_id, content_revision, layout_variant, copy_variant, category, summary_status,
  device, first_user_source, section_type, section_id;

-- Main reading sequence uses only sections actually rendered for that visit.
-- Optional theme bodies are analyzed separately, not treated as mandatory funnel steps.
WITH sequence AS (
 SELECT *,
   LEAD(section_id) OVER w next_section,
   LEAD(exposed_at) OVER w next_exposed_at
 FROM sections
 WHERE eligible AND section_type NOT IN ('theme_heading', 'theme_body')
 WINDOW w AS (PARTITION BY visit_id, content_revision ORDER BY section_position)
)
SELECT story_id, content_revision, layout_variant, copy_variant, device, first_user_source,
  section_id, next_section, COUNTIF(exposed_at IS NOT NULL) exposed_with_next_available,
  SAFE_DIVIDE(COUNTIF(exposed_at IS NOT NULL AND next_exposed_at >= exposed_at),
    COUNTIF(exposed_at IS NOT NULL)) forward_continuation_rate
FROM sequence WHERE next_section IS NOT NULL
GROUP BY story_id, content_revision, layout_variant, copy_variant, device, first_user_source,
  section_id, next_section;

SELECT story_id, content_revision, layout_variant, copy_variant, device, first_user_source,
  section_id, COUNTIF(exposed_at IS NOT NULL) heading_exposures,
  COUNTIF(opened) visits_with_open,
  SAFE_DIVIDE(COUNTIF(opened AND exposed_at IS NOT NULL), COUNTIF(exposed_at IS NOT NULL)) open_given_exposure
FROM sections WHERE eligible AND section_type = 'theme_heading'
GROUP BY story_id, content_revision, layout_variant, copy_variant, device, first_user_source, section_id;

-- Observed last location, never a claim that a hidden tab ended a session.
WITH last_checkpoint AS (
 SELECT * FROM events WHERE event_name = 'article_reading_checkpoint' AND reading_version = 1
 QUALIFY ROW_NUMBER() OVER (
   PARTITION BY visit_id, content_revision ORDER BY checkpoint_sequence DESC, ts DESC
 ) = 1
)
SELECT v.story_id, v.content_revision, v.device, v.first_user_source,
  COALESCE(e.last_section, '(unknown)') last_section,
  COALESCE(e.furthest_section, '(unknown)') furthest_section,
  COALESCE(e.checkpoint_reason, '(missing)') checkpoint_reason, COUNT(*) visits,
  APPROX_QUANTILES(e.active_ms, 100)[OFFSET(50)] median_active_ms
FROM visits v LEFT JOIN last_checkpoint e USING (visit_id, content_revision)
GROUP BY v.story_id, v.content_revision, v.device, v.first_user_source,
  last_section, furthest_section, checkpoint_reason;

-- Outcomes AFTER section exposure. A source click is not necessarily an exit.
-- A second story requires an actual story_view in the same identifiable GA session.
WITH outcomes AS (
 SELECT s.*,
   EXISTS (SELECT 1 FROM events e WHERE e.visit_id = s.visit_id
     AND e.content_revision = s.content_revision AND e.ts >= s.exposed_at
     AND e.event_name = 'article_source_action' AND e.action = 'click') source_clicked,
   EXISTS (SELECT 1 FROM events e WHERE e.visit_id = s.visit_id AND e.ts >= s.exposed_at
     AND e.event_name = 'share_copy_success') copied,
   v.reader IS NOT NULL AND v.session_id IS NOT NULL identifiable_session,
   EXISTS (SELECT 1 FROM events e WHERE e.reader = v.reader AND e.session_id = v.session_id
     AND e.ts >= s.exposed_at AND e.story_id != s.story_id AND e.event_name = 'story_view') second_story
 FROM sections s JOIN visits v USING (visit_id, content_revision)
 WHERE s.eligible AND s.exposed_at IS NOT NULL
)
SELECT story_id, content_revision, layout_variant, copy_variant, device, first_user_source,
  section_id, COUNT(*) exposed_visits,
  SAFE_DIVIDE(COUNTIF(source_clicked), COUNT(*)) source_click_rate,
  SAFE_DIVIDE(COUNTIF(copied), COUNT(*)) copy_rate,
  COUNTIF(identifiable_session) identifiable_visits,
  SAFE_DIVIDE(COUNTIF(second_story AND identifiable_session), COUNTIF(identifiable_session)) second_story_rate
FROM outcomes
GROUP BY story_id, content_revision, layout_variant, copy_variant, device, first_user_source, section_id;

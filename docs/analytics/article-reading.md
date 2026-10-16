# Article reading measurement

This adds `reading_version=1` events to the consent-gated journey contract v3
(the original rollout used v2). It measures visible content and interactions, not comprehension or exact exits.
The initial implementation is a single published layout, not an A/B experiment.

## Collection

GA and configured PostHog start after hydration by default, including passive visits.
Saved opt-outs and unavailable storage still prevent collection. The automatic
banner is temporarily disabled; `NEXT_PUBLIC_ANALYTICS_REQUIRE_CONSENT=true`
restores explicit opt-in after rebuilding. No section history is backfilled
when a reader accepts mid-page. Withdrawal stops observation and discards pending
vendor events. See [consent, privacy and release status](README.md).

The earlier GA rollout loaded asynchronously on page load, including passive
visits. The previous interaction-only loader omitted untouched visits. Do not compare bounce/engagement
rates across this rollout without marking the collection change. An immediate
departure before the tag loads can still be lost. Blocked scripts, disabled
JavaScript, consent decisions and missing identity also limit coverage.
Existing first-party popularity counts remain independent and are not a GA denominator.

The article stays server rendered. Only the reading observer runs on the client.
Every reading event includes `story_id`, `visit_id`, `reading_version`,
`content_revision`, `layout_variant`, `copy_variant`, `category`, and
`summary_status`. The revision is a server-generated hash of editorial inputs.
Popularity updates and summary refresh timestamps alone do not change it.
The initial variants are `article-2026-10` and `published`. Change the layout
variant when structure changes; assign explicit copy/experiment variants before
running a randomized comparison. No random assignment is implemented here.

Section IDs are semantic types plus a one-based ordinal, never headings or body
text. Section position is DOM order. Types: opening, brief, key_points, discussion,
theme_heading, theme_body, pending, related. Word counts are computed server-side
from the supplied editorial text; no client text, form value, share draft, raw URL
or query string is added to these custom events.

| Event | Meaning |
| --- | --- |
| article_reading_start | One instrumented article/revision per route occurrence |
| article_section_available | Section exists, including an unopened theme body; once per visit/revision/section |
| article_section_view | Section qualifies for one continuous foreground second; once |
| article_section_engaged | Viewed section accumulates five foreground seconds; once |
| article_section_time | Cumulative visible milliseconds for a section, emitted when its total changes at a checkpoint |
| article_reading_checkpoint | Cumulative article active milliseconds, last observed section, furthest qualifying section, sequence and reason |
| article_theme_toggle | Native theme opens/closes, including hash-driven expansion |
| article_source_action | Source-comment popover opens/closes or an external source link is activated |

Sources are classified as original, hn_thread, hn_comment or citation. Repeated
intentional clicks count independently; primary, keyboard and middle activation
are supported. Right-click/context-menu navigation is unobserved. Links opening
a new tab are actions, not evidence of abandonment. Opening a theme quickly may
precede its one-second heading exposure; raw opens and opens among exposed
headings are reported separately. Hash-driven opening is not evidence of a
deliberate click on the heading.

## Timing and lifecycle

- Sample every 250 ms and on reader input. A section qualifies when at least half
  of the smaller of its height and viewport height is visible. This permits long
  sections on phones. Visibility is approximate between samples.
- Require a visible, focused document. Exclude closed details bodies. Stop
  accumulating after 60 seconds without scrolling, pointer or keyboard input;
  focus/visibility return also resumes observation. This cap can undercount a
  long motionless read. A timer gap over 1.5 seconds earns no elapsed time.
- Checkpoint every 15 seconds when totals change, on hidden/blur/pagehide, and on
  route cleanup. Flushes use the original visit even if navigation already
  changed the URL. Strict Mode replay preserves totals and deduplication.
- Hidden tabs can resume. Use **last observed section**, never “exit paragraph.”
  Missing final checkpoints make dwell a lower bound. Missing checkpoint data is
  unknown, not zero. No delivery guarantee is made on process termination.
- Cumulative times must use MAX per visit/revision/section, never SUM across
  checkpoints. Nearby or nested sections can accrue concurrently (the brief
  includes key points); do not sum section dwell into article time.
- Related-story availability appears only when real recommendations have
  streamed in. Pending/empty/error placeholders are not recommendation exposure.
  Summary-pending and unavailable states remain separate report cohorts.

## GA property setup

The repository cannot establish the current property settings or BigQuery linkage.
After deployment, an analytics editor should:

1. Verify exactly one page_view per initial load and client navigation, plus the
   custom events, in DebugView. Keep automatic history pageviews as the single
   pageview mechanism; this implementation does not add manual pageviews.
2. Register event-scoped dimensions: reading_version, section_type, section_id,
   section_position, layout_variant, copy_variant, category, summary_status,
   source_kind, action, checkpoint_reason, last_section, furthest_section.
   Register visible_ms and active_ms as standard numeric custom metrics (values
   are milliseconds) and section_words as a standard numeric custom metric. They are
   cumulative snapshots; GA's default SUM is not total reading time.
3. Keep visit_id and content_revision in BigQuery rather than registering
   high-cardinality GA UI dimensions. Use existing page dimensions for article
   reports. Do not mark automatic exposure, dwell or checkpoint events as key
   events: key events affect GA engagement/bounce classification.
4. Verify the site's consent configuration and retain its collection choices.
   The observer follows the shared Analytics preferences control. Keep automatic
   form-interaction collection disabled for editable share drafts.
5. Enable/verify GA4 BigQuery daily export, retention and the session timeout.
   Record the rollout time/commit and first verified production events. Configure
   local/internal-traffic exclusions; do not use synthetic traffic as a baseline.

Custom parameters require registration for GA reports; BigQuery retains raw
event parameters. These are separate setup steps:
[event parameter setup](https://developers.google.com/analytics/devguides/collection/ga4/event-parameters),
[engagement and bounce definitions](https://support.google.com/analytics/answer/12195621?hl=en).

## Reports

Run [article-reading.sql](article-reading.sql) after replacing the dataset and
example dates. It uses completed daily exports with a one-day tail for later
events; wait 72 hours for exports to settle. Very long sessions beyond the scan
are a limitation. Save query text, job ID, date range and output with each report.
The query has not been executed against a production GA export in this change.

Outputs cover missing identity/checkpoints, section reach, sustained attention,
median saved dwell, forward continuation, theme opening, last observed location,
source clicks/copies after exposure and actual second-story views in the same GA
session. Availability supplies section-specific denominators. Forward continuation
uses first exposure order and excludes optional theme bodies from the main path.
It is observed progression, not a causal abandonment rate.

Compare the same article revision and device/acquisition cohort. The SQL's
first_user_source is GA first-user acquisition, not session-source attribution.
Show counts alongside rates; do not rank a one-visit article against a mature
cohort. Median dwell excludes missing saved time and reports that missing count.
Second-story rates exclude missing GA reader/session identity. Shared-copy success
is not publication. Source clicks may continue reading elsewhere.

For a copy test, preselect one outcome and change one feature, such as introduction
length or theme order. Randomize variants consistently before drawing causal
conclusions. Traffic mix, topic and article length confound observational comparisons.

# Hacksnap engagement measurement — historical v1

For new collection use [contract v2 and its report](README.md). The original v1
report below remains available for pre-v2 windows; do not combine the contracts.
The 30-day return-anchor event and its regression coverage are retained in v2.

Issue #15. Contract version 1, prepared 26 September 2026. Collection starts only after this code reaches production. No measured baseline or target is available yet.

## Event contract

Events use GA4 via the existing `gtag` setup. All IDs are public HN story IDs. No title, summary, editable post contents, link text, or clipboard text is sent. Analytics failures and blocked storage leave site actions working.

| Event | Trigger | Parameters |
| --- | --- | --- |
| `story_view` | First render of a distinct `/story/{id}` in a 30-minute browser-tab tracking session, including client navigation | `story_id` |
| `recommendation_exposure` | At least half of a Read next story link intersects the viewport; once per source/target pair per tracking session | `story_id`, `target_story_id`, `placement=read_next` |
| `recommendation_click` | Reader activates a Read next story link | Same as exposure |
| `share_menu_open` | A feed or story Share menu opens | `story_id`, `placement=feed\|story_top\|story_end` |
| `share_destination_select` | Reader activates a network or email destination | `story_id`, `destination`, `placement` |
| `share_copy_success` | Clipboard API resolves successfully | `story_id`, `copy_kind=post\|link`, `placement` |
| `share_copy_failure` | Clipboard API rejects or is unavailable | Same as success |
| `share_manual_fallback` | Selectable fallback text is offered after a copy failure | Same as success |
| `return_visit` | A new page load is at least 24 hours and at most 30 days after the stored visit anchor; intervening loads under 24 hours leave the anchor intact | `observation_window_days=30`, `days_since_visit_anchor` |

`placement` on feed Share actions is `feed`; story actions use `story_top` or `story_end`. A destination selection means only that the destination was opened. A manual fallback means the text was offered; it cannot establish that the reader copied it. Copy link and Copy suggested post use the same outcome distinctions.

## Definitions and report

Run [engagement-baseline.sql](engagement-baseline.sql) against the GA4 BigQuery daily export. Replace the dataset placeholder and cohort dates. Export must include the complete 30-day follow-up through `cohort_end + 30 days`. Use the same dates, device categories, first acquisition sources, reporting timezone, and consent scope for baseline and follow-up. GA4 `ga_session_id` plus `user_pseudo_id` defines a reporting session; GA4 ends sessions after 30 minutes of inactivity. The client also expires its deduplication key after 30 minutes. Browser tabs can have separate deduplication keys within one GA session, so the SQL counts distinct IDs and pairs.

1. **Second-story visit rate:** GA sessions with at least two distinct `story_view.story_id` values divided by GA sessions with at least one. A repeat visit to the same story does not count.
2. **Recommendation click-through:** distinct visible source/target story pairs clicked in the same GA session divided by distinct visible source/target story pairs exposed in cohort dates. Clicks without exposure are excluded. `IntersectionObserver` unavailable browsers cannot contribute exposures and should be reported separately if material.
3. **Sharing and copy outcomes:** report menu opens, destination selections, successful clipboard writes, failed writes, and manual fallbacks as separate action counts and distinct sessions. Do not call an outbound selection a share publication or a fallback a successful copy. For a copy-success rate, use successful writes divided by successful plus failed writes for the same `copy_kind` and placement.
4. **Observed 30-day return rate:** distinct readers with a `return_visit` 1–30 days after their first cohort story divided by distinct readers with a cohort story view. The client retains its visit anchor through same-day loads, advances it when a return qualifies, and resets it after 30 days without a qualifying return. Requires 30 days of follow-up. The browser event requires working local storage and GA identity; this is an observed, consented-browser rate, not a person-level retention estimate.

For every result record the cohort start/end, export cutoff, device/source segment, numerator, denominator, rate, release version, and any missing data. Suppression by consent, ad blocking, deleted cookies, cross-device use, and GA export gaps bias the observed rates. `traffic_source.source` represents first acquisition source, not session attribution.

## Baseline status

| Item | Status |
| --- | --- |
| Pre-release baseline | Unavailable: existing GA page views did not contain these custom events, exposure, or truthful copy outcomes. |
| First observed baseline | Pending production deployment and 30 days of follow-up. Record exact dates and sample counts before comparing rates. |
| Improvement targets | Pending observed baseline and sample-size review. Do not set numerical targets from the prototype. |
| Final integrations | Recheck this contract and journey checks after issue #14's shared Share menu and the other navigation/reading changes land. |

Controlled checks: visit story A, revisit A, then visit B; expect one `story_view` per ID within the tracking session. Scroll a Read next link into view and click it; expect one exposure and one click with matching IDs. Open each Share menu, select a destination, allow and deny clipboard access; confirm distinct events and that a failed copy offers manual fallback without reporting success. Repeat with GA blocked; the full journey should still work. The helper unit checks cover deduplication, return-window gating, and blocked analytics; a browser journey check is still required on the final integrated UI.

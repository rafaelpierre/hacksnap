# Engagement measurement (issue #15)

## Contract v2

This extends the event names and share placements merged in PR #21. Version 2
changes story/recommendation deduplication from tab sessions to route occurrences and
adds explicit visit IDs, copy attempts and recommendation positions. Do not pool
v1 and v2 rates. [The v1 contract](engagement-baseline.md) remains a historical reference.

Custom GA4 events contain `contract_version=2` and a random `visit_id` for each
pathname occurrence. Re-rendering, Strict Mode effect replay, and query-only changes
do not create visits. A → B → A and a hard reload each create a fresh visit. Browser
Back counts as a visit. The existing optional 30-day return anchor in local storage is retained.
GA supplies pseudonymous reader/session IDs and device/acquisition dimensions.

| Event | Trigger | Additional parameters |
| --- | --- | --- |
| reader_visit | Hydrated route occurrence | none |
| story_view | Existing story page mounts | story_id |
| recommendation_exposure | At least 50% of a recommendation is visible, once per visit/source/target/position | story_id, target_story_id, position (1-based) |
| recommendation_click | Recommendation link activated by primary/keyboard/middle click, once per opportunity | same as exposure |
| share_menu_open | Closed menu opens | story_id |
| share_destination_select | Network/email destination selected | story_id, destination |
| share_copy_attempt | Copy link/post requested | story_id, copy_kind (link/post) |
| share_copy_success | Clipboard write resolves | same as attempt |
| share_copy_failure | Clipboard unavailable or write rejected | same as attempt |
| share_manual_fallback | Failed attempt offers selectable text | same as attempt |
| return_visit | Existing anchor qualifies after 24 hours through 30 days; same-day loads preserve it | observation_window_days=30, days_since_visit_anchor |
| story_return | Contextual return link activated | none |

Clicks establish exposure if the observer has not fired. Without IntersectionObserver,
only clicked recommendations are observed; exclude unsupported browsers from CTR
comparisons where identifiable. Exposure requires no dwell time. Right-click context
menu opening is not a click; context-menu navigation cannot be measured reliably.
Repeated intentional share/copy actions count independently. Destination selection
is not evidence of publication. Manual fallback is not evidence of a completed copy.
Pending-summary story pages count; missing/404 stories do not.

Share events preserve placement=feed/story_top/story_end; recommendation events
preserve placement=read_next. Destination values remain lowercase.

The helper allowlists fields. Never pass editable drafts, titles, URLs, emails, or
query strings. Destination controls open URLs on activation without putting edited
text into anchor URLs, avoiding GA automatic outbound-link collection of drafts.
Do not enable GA form-interaction collection or DOM/text scraping for share drafts.
Analytics calls are best effort, queue before GA loads, and catch failures. Navigation
and copying must remain functional with blocked scripts, storage, and analytics.

## Measures and reproducible analysis

Run [engagement.sql](engagement.sql) against completed GA4 BigQuery daily exports.
Replace the dataset and example dates; dates in the SQL are placeholders, not recorded
collection dates. Use UTC for window boundaries. Export may lag up to 72 hours; wait
for daily tables to settle and save query text, job ID, export range, and results.

1. **Second-story visit rate:** sessions with at least two distinct story IDs / sessions
   with at least one story. Reloading the same story cannot satisfy the numerator.
   Session identity is `(user_pseudo_id, ga_session_id)`; configure/verify GA's 30-minute
   inactivity timeout. The query scans a one-day lead-in and seven-day tail, excludes
   sessions first seen reading before the cohort window, and includes later story
   visits in the same session. Very long sessions beyond these bounds are a limitation.
2. **Recommendation CTR:** exposed opportunities with a click / exposed opportunities,
   keyed by visit, source story, target story and position. Never use page loads as
   the exposure denominator. The query reports each position separately.
3. **Sharing:** visits with both a menu open and destination selection / visits with a
   menu open. Also report raw menu/destination counts and copy successes / copy attempts
   separately for link/post, with failure and fallback counts. A copy pending at the
   collection boundary can leave an unmatched attempt; allow completion time and
   report mismatches. No claimed publication or manual-copy completion rate.
4. **Seven-day return rate:** readers with a visit in a different GA session within
   seven elapsed days after their first observed visit in the cohort / identifiable
   readers first observed in the cohort. This is first observed in this collection,
   not first-ever or GA's new-user classification. Compute the first visit across
   the entire scanned range, including the lead-in day, before applying cohort
   boundaries. Readers first seen on that lead-in day are excluded; activity
   before the scanned range remains unknown. Allow seven full days of follow-up
   for every reader. Same-session repeat visits are not returns.

Split results by device and GA first-user acquisition source, as in the SQL; that
source is not session traffic attribution. Compare the same weekdays, campaign mix,
contract version, eligibility and device cohorts. Keep unknown attribution separate.
Readers can clear cookies/change devices; consent, blockers, missing GA IDs and bots
limit coverage. The report includes missing-ID counts; reading and return measures
exclude them. Custom events are not a census. Avoid high-cardinality GA UI custom
dimensions for visit IDs; BigQuery event_params suffice. Do not infer targets from
synthetic test traffic.

## Baseline register — pending

As of 2026-09-26 this branch has instrumentation, not deployed measurements.

| Item | Status |
| --- | --- |
| Production deployment time / commit | Pending deployment |
| GA property access, BigQuery export and retention | Pending verification by analytics owner |
| Session timeout and draft/form collection settings | Pending property verification |
| Collection start/end and mature follow-up end | Pending first production event verification |
| Reading sessions / second-story sessions / rate | Pending observations |
| Exposures / clicked exposures / CTR by position | Pending observations |
| Menu visits / destination visits, copy attempts / outcomes | Pending observations |
| Eligible readers / seven-day returns / rate | Pending mature observations |
| Device/source counts and exclusions | Pending report |
| Improvement targets and justification | Pending measured baseline |

No pre-release baseline was available during implementation. Label the first collected
window **first observed post-release baseline**, not a before/after UX improvement.
Start with two complete weeks, plus seven days return follow-up and export lag. Report
counts and 95% Wilson intervals for each proportion. Extend collection if cohorts
remain too sparse for the intended decision; choose a meaningful detectable change
and calculate required sample sizes before setting targets. Record the chosen target,
interval, sample size, cohort and rationale here. Do not close #15 until property
access, deployment, measured counts/rates and justified targets are recorded, or
remaining work is explicitly assigned and tracked in a follow-up issue.

## Controlled checks

Run `npm run test:analytics`, `npm run test:share`, `npm run test:categories` and
`npm run typecheck` in hacksnap/web. The analytics tests cover route recurrence,
deduplication, exposure/click counting, content allowlisting, queued events and failed
sinks. The DOM test renders the production components under React Strict Mode and
checks visibility thresholds, repeated renders, query-only changes, navigation,
middle clicks without IntersectionObserver, destination selection, copy resolution,
denied/missing clipboard and a throwing analytics sink. Copy helper tests also
verify asynchronous clipboard success/rejection.

Before deployment, capture `dataLayer` or use GA DebugView on desktop and phone:

- Browse → story A → visible recommendation → story B → contextual return → Back.
  Expect distinct route visit IDs, one story event per story occurrence, and one
  exposure/click per recommendation opportunity. Re-render and scroll away/back;
  there must be no extra exposure. Test keyboard and middle-click as well.
- Open/close/reopen Share: two opens. Select each destination: selection only.
  Copy link and an edited post: attempt then success only after write resolves.
  Deny clipboard: attempt, failure, manual fallback, and no success.
- Inspect all GA requests: no draft contents or destination URLs containing drafts.
  Block GA and deny storage; repeat navigation and successful/failed copy journeys.
- Wait out the configured session timeout and return; verify a different GA session
  ID under the same reader. Validate the report against a separately marked test
  property before production collection. Do not include test traffic in the baseline.

Browser/DebugView checks and live BigQuery execution remain pending; local helper
checks do not establish production delivery or replace the release checklist above.

## Original branch validation — 2026-09-26

Analytics tests (6), share tests (6), category/recommendation/navigation tests (5),
TypeScript checking and the production build passed. Category tests stalled on the
local Node 23 runtime and passed on CI's Node 22 runtime. Test data is synthetic and
provides no engagement baseline. Live GA/BigQuery verification remains pending.

## Integration with main — 2026-09-26

PR #21 landed before this branch. The merge retains its public event names, lowercase
destinations, share placements, 30-day return-anchor fix, reusable copy helper,
extracted StoryContent and UI tests. One recommendation wrapper owns exposure/click
emissions; NextStoryLink handles navigation only. StoryContent owns story views, so
missing stories do not generate a story event. Contract v2 distinguishes the changed
route-level counting from historical v1 tab-session deduplication. The original
baseline query explicitly excludes v2. The seven-day report is a distinct measure
from the retained 30-day anchor diagnostic; do not compare those as the same rate.

Merged validation: all 25 analytics, return-anchor, share, category/navigation and
story UI tests passed on Node 22, along with typechecking and the production build.

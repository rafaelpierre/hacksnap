# Hacksnap journey analytics

## Release status

The v3 client integration adds PostHog alongside GA4. Analytics now default to on,
with the automatic consent banner temporarily disabled and saved opt-outs honored.
Production delivery, replay masking, heatmap rendering and baseline values are **unverified** until an
authorized release is checked. Local fixture results are not production measurements.

On 2026-10-16, EU project **308138** was matched to the supplied public project token.
Replay was enabled for 10% of consenting sessions, minimum duration was set to zero,
and project-level console/performance recording was disabled. Heatmaps were enabled
with these three saved capture rules:

- `https://hacksnap.live/`
- `https://hacksnap.live/story/*`
- `https://hacksnap.live/topics`

The three dashboards exist and their queries execute against the currently empty
production dataset:

- [Acquisition and exits](https://eu.posthog.com/project/308138/dashboard/1028900)
- [Reading journeys](https://eu.posthog.com/project/308138/dashboard/1028901)
- [Retention and quality](https://eu.posthog.com/project/308138/dashboard/1028902)

[posthog-dashboards.json](posthog-dashboards.json) preserves their query definitions
and IDs. These are derived project definitions, not certified Data Catalog metrics.
The starter dashboard was left unchanged. Do not interpret pre-release zeros as a baseline.

## Configuration and consent

Install dependencies with Node 22 and `npm ci` in `hacksnap/web`. Set these public
build-time variables in an ignored `.env.local` and the hosting provider:

```dotenv
NEXT_PUBLIC_POSTHOG_ENABLED=true
NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN=<the supplied phc_ project token>
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
NEXT_PUBLIC_ANALYTICS_REQUIRE_CONSENT=false
```

The three production variables were saved in Vercel on 2026-10-16 for the next
authorized build; no deployment was triggered. Preview has no PostHog configuration.
The ignored local configuration uses the supplied token with the switch off to keep
development traffic out of this project. `.env.example` documents the same default.

Only the public project token belongs in the browser. Never use a personal or
secret API key. Missing configuration, a host other than the EU ingestion host,
or `NEXT_PUBLIC_POSTHOG_ENABLED` other than `true` disables PostHog. GA4 remains
independently controlled by the same analytics preference. Changing a public
variable requires rebuilding.

`NEXT_PUBLIC_ANALYTICS_REQUIRE_CONSENT` defaults to false when unset. New readers
start with analytics enabled, without showing the banner or writing an acceptance
record. Saved declines are respected. Set the variable to `true` and rebuild to
restore the automatic banner and explicit opt-in. The banner, preference storage,
withdrawal and cross-tab code remain in place.

The small `instrumentation-client.ts` entry installs a consent-aware runtime.
After hydration it dynamically imports the pinned `posthog-js` SDK when analytics
are enabled. GA4 also loads asynchronously, preserving passive-visit coverage
from the article-reading rollout on main. Neither provider waits for reader input;
very early exits can still interrupt loading.
No server SDK, proxy or database change is included. A tiny inline bootstrap sets
GA to disabled before hydration; it emits nothing and preserves Next's early
stylesheet prelude on delayed streamed pages.

The nonmodal preference offers equally prominent Allow and Decline controls,
explains masked replay, supports Escape, and stays available through the footer's
Analytics preferences button. Declined or unavailable storage means no vendor
events, identifiers, SDK download or buffered replay. With explicit opt-in restored,
an unknown choice also prevents collection. Acceptance starts a fresh visit on the
current page; earlier activity is not backfilled. Repeated
acceptance does not duplicate it. Withdrawal stops capture/recording, drops pending
events and clears analytics storage/cookies. Storage events synchronize tabs.
Requests already transmitted before withdrawal cannot be recalled.

First-party `/api/story-events` popularity collection and functional story/scroll
history remain independent. Acceptance and withdrawal never replay their story
views. Most read still uses historical GA page-view seeds plus first-party views;
clicks do not enter its ranking. See [the web README](../../hacksnap/web/README.md)
and [seed documentation](../../data/seeds/README.md).

## Privacy boundaries

SDK defaults are pinned to `2026-05-30`, with explicit pageview, pageleave,
autocapture and recording options. Person profiles are disabled; no account
identification, aliasing or server identity is used. Anonymous browser/session IDs
can change after withdrawal, cookie clearing or browser/device changes.

- The route lifecycle owns pageviews and pageleaves. Automatic pageviews are off.
- Click autocapture masks text and attributes. Copied-text/form capture is off.
- Replay masks every input and blocks the share editor, manual-copy fallback and
  elements marked `data-analytics-private`. Console, headers, response/request
  bodies and cross-origin iframe recording are off.
- Event sanitization strips raw queries, hashes, campaign fields, element text,
  element attributes and titles, including nested SDK properties. Referrers retain
  only origins/domains. Replay metadata and URL attributes have separate masking.
- Custom actions use IDs, enums, positions and destination types; never pass draft
  content, emails, source comment text or raw outbound URLs.

The pinned SDK has no discard-only shutdown. Its normal shutdown flushes pending
batches. Withdrawal closes its dispatch gate after disabling collection and
persistence; the browser regression test must keep proving that queued batches,
late retries and unload cannot send after withdrawal. Revalidate this behavior
before upgrading the SDK.

In GA4 property settings, keep enhanced automatic history pageviews and form/
outbound collection disabled: the app owns route and onward-action events.
Confirm those settings and actual GA requests during production verification.

## Contract v3

A route identity is **pathname plus sorted query parameters, excluding `journey`**.
Filter and pagination changes create visits. Reordered parameters, transient
journey tokens, rerenders and Strict Mode effect replay do not. A → B → A,
Back/Forward, a restored document and a reload create new vendor visits.
Raw query values are used only in memory for deduplication. Valid category IDs
and bounded pagination numbers may be emitted as structured fields.

Custom events retain their names and carry `contract_version=3` plus a random
`visit_id`. PostHog adds anonymous session/device fields. `route_type`, category,
layout version and sanitized referrer support segmentation. PostHog also records
`landing_page_type` for the session and `reader_type=first_observed|returning`.
“First observed” is browser-scoped, not first-ever or an account signup.

| Event | Meaning and fields |
| --- | --- |
| `$pageview` / GA `page_view` | One per analytics-enabled route occurrence; canonical public URL |
| `$pageleave` / GA `page_leave` | Navigation or document exit; duration and maximum scroll/content percentage |
| `reader_visit` | Hydrated analytics-enabled route occurrence |
| `story_view` | Existing story mounts or is current at acceptance; story_id, category_id, summary_state ready/pending |
| `story_click` | Internal story activation, once per target/visit; story_id, placement, category_id and feed position when available |
| `feed_story_exposure` | At least 50% of a feed card visible; deduplicated across virtual remounts by story/position/visit |
| `feed_load` | Current-feed request settles; trigger auto/manual, outcome success/empty/failure/cancelled, cumulative loaded_count and feed_page |
| `feed_end` | Current feed has no next page; exhausted/selection_limited, cumulative loaded_count and feed_page |
| `story_section_view` | Visible summary, discussion or read_next marker, once per visit/section |
| `story_engagement` | Cumulative active_seconds; maximum per visit is the measure, never sum snapshots |
| `outbound_click` | Destination article, hn_thread or hn_comment; story_id and placement, no destination URL/text |
| `recommendation_exposure` | At least half a recommendation visible; story_id, target_story_id, position and placement=read_next |
| `recommendation_click` | Activation of the same visible opportunity; click also establishes exposure |
| `share_menu_open` | Share menu opens; story_id and placement |
| `share_destination_select` | Destination selected; lowercase destination; intent only, not publication |
| `share_copy_attempt/success/failure` | Requested clipboard write and its resolved/rejected outcome; copy_kind link/post |
| `share_manual_fallback` | Selectable text offered after failure; not evidence of completed copy |
| `story_return` | Contextual return activation |
| `return_visit` | Retained 24-hour-to-30-day anchor diagnostic; not the seven-day cohort metric |

The current Latest feed does **not** emit the legacy ranked-feed
`home_story_open`, `home_feed_load` or `home_feed_end` contract. Those names remain
supported for historical code/report compatibility; do not mix them with the
current `feed_*` events. Pending stories count as views; missing stories do not.

Active reading accumulates only while the document is visible, focused and within
60 seconds of reader activity. Navigation/acceptance starts the initial window;
pointer, keyboard, focus and scroll input renew it. Cumulative snapshots occur every
15 seconds and at visibility/exit boundaries. Unchanged idle snapshots are skipped.
Exposure has a 50% visibility threshold and no dwell requirement. Without
IntersectionObserver, only clicked opportunities are proven visible. Context-menu
navigation cannot be measured reliably; keyboard, modified and middle clicks are
covered. Intentional repeated sharing actions remain separate events.

The detailed `reading_version=1` article events added on main are preserved under
contract v3 and share the consent gate. See [article reading](article-reading.md)
for section dwell, theme toggles, source actions and checkpoints. Their observer
starts fresh on acceptance, stops on withdrawal, and binds late checkpoints to
the original route and consent epoch. Use `story_engagement` for the headline
active-seconds measure; do not add the two cumulative clocks together.

## Measures and dashboards

1. **Second-story rate:** sessions with two or more distinct story IDs divided by
   sessions with at least one. Reloading one story cannot qualify. The dashboard
   uses complete UTC days and splits by device. Boundary sessions can span the
   selected period; retain this limitation when comparing windows.
2. **Seven-day return:** analytics-enabled browser identities with a pageview in another
   session within seven elapsed days of their first observed pageview. First
   observation is searched from the rollout collection floor, then only cohorts
   at least seven days old are admitted. Never treat an immature cohort as zero.
3. **Recommendation CTR:** clicked visible opportunities / visible opportunities,
   split by position. One opportunity is visit/source/target/position. Keep counts
   alongside rates; page loads are not the exposure denominator.
4. **Active reading:** median of each story visit's maximum active seconds, and
   share reaching 30 seconds. Include story views without a snapshot as zero.
5. **Native bounce:** PostHog's definition is one pageview, no autocapture events,
   and less than 10 seconds (subject to the project's configurable threshold).
   The native dashboard is displayed separately from the custom measure below.
6. **Low-engagement exit:** a closed session with one pageview, under 30 active
   seconds and no story/recommendation click, source click, confirmed copy or
   contextual return. Closed means no events for 30 minutes. Heartbeats,
   exposures and generic autocapture are not useful actions for this measure.
   Destination selections remain visible separately as unconfirmed intent.

Segment by device, landing-page type, referrer domain, category and first-observed/
returning reader. Native insight filters can be changed in PostHog. SQL-backed
headline tiles contain explicit windows and grouping; edit their saved query when
changing those segments/windows rather than assuming dashboard filters rewrite SQL.

The consent rollout changes who is measured. Do not compare its rates directly
with the previous unrestricted GA4 population or pool contract versions.
[engagement.sql](engagement.sql) defaults to v3 and accepts exactly one version;
[engagement-v2.md](engagement-v2.md), [engagement-baseline.md](engagement-baseline.md)
and its v1 query preserve historical definitions and dated evidence.

## Free allowances and heatmaps

Billing UI checked 2026-10-16: the organization is on the free plan, with no paid
upgrade, a 1-million product-event limit and 5,000 web replays per billing cycle.
The current cycle runs October 16–November 15. Heatmap ingestion is free and the
free plan supports three capture rules. Product events are unsampled; replay
starts at 10% of analytics-enabled sessions, with no short-session filter.

The free plan has no editable dollar caps until a payment card is added. Do not
add a card or upgrade for this release. Its free allowances enforce the zero-spend
intent. If billing is enabled later, set each used product's limit to **$0 before
collecting more**, preserve free-allowance alerts and verify the limits in the UI.
PostHog documents owner alerts at 80% and 100% of free allowances/limits. Hitting a
limit loses subsequent data: annotate collection gaps and extend the baseline;
there is no later backfill.

Use the in-app Heatmaps tool with screenshots or recording snapshots. Toolbar
heatmaps require a paid plan. Preserve the site's iframe protection; do not loosen
CSP or frame headers. Saved screenshot heatmaps require an exact page URL, so pick
representative stories under the `/story/*` capture rule after release. Verify a
mobile and desktop background before declaring heatmaps ready.

Compare mobile and desktop separately. Feed contents change and story lengths
vary, so coordinate maps across those pages are exploratory. Section markers and
story-position events are the reliable comparison units. The current UI notes
capture-rule enforcement is being rolled out. The client also drops heatmap points
outside these three rules and strips query/hash text from heatmap URL keys.

## Validation and release

Run Node 22 `npm ci`, `npm run lint`, `npm run format:check`, `npm run test:ci`,
`npm run typecheck`, `npm run build` and `npm run test:browser:ci` from `hacksnap/web`.
The browser fixture explicitly copies instrumentation-client.ts, substitutes a
dummy public token and serves all PostHog/GA requests locally. No test traffic
should reach the production project. Other external requests still fail tests.

Before release, verify:

- Default-on without a saved choice or automatic banner, saved declines, accept,
  withdraw, reaccept, cross-tab, blocked storage and restoration of explicit opt-in.
  Acceptance mid-story produces one vendor pageview/story view and no extra
  first-party popularity view. With opt-in restored, no pre-consent replay buffering.
- Filter/pagination changes, reordered queries, Strict Mode, new tabs, Back/Forward,
  document exit and restored documents. One pageview per occurrence.
- Foreground/idle reading time, virtualized exposure deduplication, recommendation
  denominators, clipboard outcomes, empty/failed/cancelled feed loads.
- Actual event requests and decoded replay snapshots containing test query/hash/
  draft markers. They must be absent. Check analytics-blocked reading/navigation.
- Consent controls at 320px, desktop and 200% text, with keyboard navigation;
  existing route asset, image, font and layout budgets remain passing.

After an authorized production release, record deployed commit/time, confirm both
providers' event delivery, inspect replay input/share/URL masking, render the three
heatmap rules, reconcile a small controlled journey against dashboard counts,
and recheck billing/free allowances and GA automatic-collection settings. Only
then record the baseline start. Production verification is still outstanding.

## Improvement cycle and rollback

Collect two complete weeks after verified production delivery, then allow seven
more days for return cohorts to mature. Extend collection when traffic is too low.
Record numerator/denominator, device and acquisition mix, exclusions, collection
gaps and confidence intervals. No improvement targets are justified yet.

Review funnel drop-offs, heatmaps and representative short and long replays together.
The initial investigation backlog is:

1. Whether readers reach Related stories (the read_next section) below discussion
   and sharing, and whether visible recommendations lead to a second distinct story.
2. Whether mobile readers discover topic navigation and return to the feed.
3. Whether load failures or scroll restoration interrupt continued reading.

For each later change, record evidence, hypothesis, primary metric, guardrails,
required sample and stopping rule; implement one change behind a feature flag.
Use second-story rate or seven-day return as primary outcomes, with reading time,
useful onward actions and bounce as supporting evidence. Report insufficient
samples as inconclusive. Longer sessions alone do not establish improvement.

Rollback PostHog by setting `NEXT_PUBLIC_POSTHOG_ENABLED=false` and rebuilding.
For immediate collection control, disable replay/heatmaps in the project as needed.
To withdraw both providers, use Analytics preferences. To restore opt-in collection
and the automatic banner, set `NEXT_PUBLIC_ANALYTICS_REQUIRE_CONSENT=true` and rebuild.
A code rollback must retain saved opt-outs and withdrawal. Keep historical data and
queries versioned instead of deleting them.

## References

- [Next.js integration](https://posthog.com/docs/libraries/next-js)
- [Replay privacy controls](https://posthog.com/docs/session-replay/privacy)
- [Native bounce definition](https://posthog.com/docs/web-analytics/dashboard)
- [Heatmaps and free-plan URL rules](https://posthog.com/docs/toolbar/heatmaps)
- [Billing limits and alerts](https://posthog.com/docs/billing/limits-alerts)

## Default-on validation (2026-10-16)

Node 22 checks passed: locked install, lint, formatting, all 484 Jest tests,
typechecking, production build, cache smoke and all 199 browser checks.
New-reader collection starts without input or a saved acceptance record. Saved
opt-outs, withdrawal, cross-tab changes, blocked storage and vendor payload masking
remain covered. The opt-in switch is tested with no saved preference.

The automatic panel stays hidden at 320px and 1280px with 100% and 200% text.
Footer preferences still open, Allow enables analytics, Turn analytics off stops
collection, and Escape returns focus to the footer control. Keyboard and Axe checks
pass. Reviewed fixture screenshots: [mobile without the banner](ui/banner-disabled-mobile.png),
[desktop without the banner](ui/banner-disabled-desktop.png), and
[preferences at 200% mobile text](ui/preferences-mobile-200.png).
These local results do not establish production delivery or an engagement baseline.

## Local validation — 2026-10-16

Node 22 validation passed after integration with the current main branch:
`npm ci`, lint, formatting, all **482 Jest tests (87 suites)**, typechecking,
production build, cache smoke and all **198 browser checks** (Chromium and iPhone
WebKit). Existing asset/rendering budgets were unchanged. The delayed-content
layout check also passed four parallel reproductions after preserving the early
stylesheet prelude.

Real SDK requests were intercepted locally and decoded, including flags, events,
heatmap URL keys and replay snapshots. Synthetic query/hash/input/draft markers
were absent. Withdrawal stopped later requests and removed identifiers. Tests
covered consent transitions, cross-tab changes, blocked storage/vendors, missing
configuration, route/query/history deduplication, first-party counts, active-time
boundaries, late callbacks, clipboard outcomes and feed failures. Cached server
rendering and browser-restored visits were included.

Consent controls passed keyboard and Axe checks at 320px/1280px and 100%/200% text.
Reviewed screenshots: [mobile](ui/consent-320.png), [desktop](ui/consent-desktop.png).
These are synthetic fixtures, not production evidence. Live GA delivery/settings,
PostHog delivery, replay rendering/masking and heatmap backgrounds still require
post-release verification before the baseline starts.

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

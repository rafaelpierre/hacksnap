# Production browser regressions and performance budgets (#148)

`npm run test:browser:ci` in `hacksnap/web` builds the real App Router application
with deterministic, server-only fixture data, then starts `next start` on
127.0.0.1:3100. The normal production source never imports the fixtures. There is
no runtime fixture flag or public control endpoint. An explicit copy allowlist
excludes `.env` files; the child environment includes only an explicit allowlist of
runtime basics (PATH, HOME, temporary-directory settings, CI, timezone and locale).
Only the ignored `.browser-app/lib/data.ts` is replaced. Generated output is a
test artifact and must never be deployed. CI independently builds the ordinary app.

## Scenarios and bounded execution

- Real home, archive and category links open a story and return through breadcrumbs;
  browser Back and Forward exercise the Next router and hydration lifecycle.
- Two distinct `/` history entries are created with a story and the home wordmark.
  Each preserves its story position when traversed; tests never manufacture history.
- A no-JavaScript context follows server-rendered links and opens native source popovers.
- Storage and clipboard denial preserve appearance switching, reading and manual copy.
- Story 91000002 delays optional recommendations by 2.5 seconds; 91000003 fails that
  read. The article must remain usable. A controlled continuation 503 exposes retry.
- Source popovers and sharing open with the keyboard, close with Escape and restore
  focus. Axe checks WCAG 2 A/AA and 2.1 AA on the open controls and route matrix.
- Home/story HTML, negotiated Markdown and Markdown HEAD use actual server requests.
- Home, archive, category, Topics, About, API documentation and story are checked at
  320px / 1280px, light / dark and 100% / 200% text. Assertions cover overflow, heading size, image loading and
  responsive width selection, sticky-header clearance, reading-column bounds and
  share-panel placement. Screenshots retain the complete visual evidence.
- Every browser test fails on unexpected console/hydration errors and external
  requests. The deliberately failed continuation permits the browser's HTTP error log.

The suite has one worker, no retries, a four-minute test deadline and a twelve-minute
CI job deadline including installation/build. Browser assets are local; analytics
requests receive an empty local script. The synthetic illustration is generated
at the configured optimizer widths and returned to browser image requests, so
`next/image` markup and browser candidate selection remain exercised. This does
not benchmark Blob latency or the optimizer's server CPU; those need separate checks.

## Budgets

`hacksnap/web/e2e/budgets.json` contains the enforced ceilings per route. Each
navigation starts in a fresh browser context with DPR 1 and a 1280px viewport.
Measurement ends 500ms after initial network idle and font readiness, before reader
interaction. Initial JS, CSS and image response bodies are counted once per URL.
CSS includes inline style elements, so toggling CSS inlining cannot evade the budget.
Gzip estimates use level 9 and are separate from decoded body sizes; these are
repeatable asset-size comparisons, not claims about production HTTP transfer.

LCP uses the browser's buffered Largest Contentful Paint observer. CLS uses the
maximum layout-shift session window (one-second gap, five-second maximum), excluding
recent input. The rendering ceilings allow slower CI machines; no overall Lighthouse
score is required. Per-route JSON measurements and asset lists are attached to the
HTML report. The checked-in baseline records a local run; timing is machine dependent.

For an intentional budget change, compare the attached measurements to the baseline,
identify which asset/feature causes the increase, and include the tradeoff and before /
after figures in the PR. Re-run the complete browser suite; a reviewer must explicitly
review changes to `budgets.json` and the baseline. Do not regenerate limits from the
current result or weaken a gate to hide a regression. For platform-independent visual
checks, layout invariants are enforced and screenshots are reviewed, rather than
accepting pixel baselines created by a different operating system.

## Manual release check

Automated accessibility checks do not replace assistive technology testing. Before a
release affecting these controls, use VoiceOver/Safari and NVDA/Firefox or Chrome to
check heading/landmark navigation, source dialog announcement and dismissal, share
focus order and return, manual-copy instructions, loading/retry announcements, and
200% text at a narrow viewport. Record browser, screen reader, version and results in
the release/PR checklist. #132 and #133 continue to own their feature-specific scenarios.

## Regression found by the suite

The existing unconditional `story/[id]/loading.tsx` boundary flushed a loading shell
for ordinary document requests, leaving the article hidden without JavaScript.
Removing that boundary lets the async article reach the initial document. Optional
recommendations retain their own Suspense boundary. Client story links already show
`Opening story…` and `aria-busy` while navigation is pending; a delayed real router
request verifies that feedback and the readable feed while the destination loads.

## Recorded baseline and visual evidence

The final local run passed **24 tests in 44.3 seconds**, including the 7-route ×
2-width × 2-theme × 2-text-size matrix (56 route states). Lint, formatting and
TypeScript also passed. [Baseline measurements](issue-148/baseline.json) record the
browser version and each route's measured values alongside its reviewed ceiling.

| Route | Initial JS / gzip | CSS / gzip | Image | Local LCP | CLS |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/story/91000001` | 526,642 / 159,617 B | 40,951 / 8,970 B | 2,696 B | 32 ms | 0.000000 |
| `/category/models-products` | 551,025 / 168,025 B | 40,951 / 8,970 B | 1,102 B | 48 ms | 0.000005 |
| `/` | 551,025 / 168,025 B | 40,951 / 8,970 B | 1,102 B | 40 ms | 0.000010 |
| `/archive` | 551,025 / 168,025 B | 40,951 / 8,970 B | 1,102 B | 48 ms | 0.000005 |

The initial limits provide about 11–12% decoded JS/CSS headroom and 7–13% gzip
headroom. Fixture-image ceilings allow variation in encoder/platform output while
still catching larger candidate requests. Rendering gates remain 3.5 seconds LCP
and 0.1 CLS to accommodate CI contention; the local timing above is not a mobile
network benchmark. This is an initial reviewed baseline, not an automatic update.

Representative captured states:

- [Story, desktop light](issue-148/story-1280-light.png)
- [Story, desktop dark](issue-148/story-1280-dark.png)
- [Story, 320px light with 200% text](issue-148/story-320-light-200.png)
- [Open share panel, 320px dark with 200% text](issue-148/share-320-dark-200.png)

All matrix screenshots, JSON measurements and failure traces are retained in the
CI artifact. The selected screenshots above document populated story content after
the CSS extraction and disabling of CSS inlining.

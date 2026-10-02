# Issue #149: CSS reachability and transfer

Measured on 2026-10-02 with Node 22, Next.js 16.3.6 production builds and headless Chromium on localhost. The baseline is `fbaec6a` with `experimental.inlineCss: true`. The trimmed build keeps inlining; the final comparison uses the same trimmed source with `inlineCss` disabled. Each route starts in a fresh browser context, then makes a second full-document navigation to the same URL. `performance` navigation and resource `transferSize` values include response overhead and reflect compressed HTTP transfer. CSS bytes are the sum of stylesheet resources, with inlined CSS already counted in HTML. No throttling was applied.

The local build has no database credentials. Home, archive, category and story requests returned the app's data-unavailable fallback; `/story/12345678` is **not a populated story**. These measurements establish stylesheet transfer and fallback HTML costs, not production story or feed latency. `/docs/api`, `/about`, and `/topics` rendered their normal content.

## Reachability audit

No active route or component imports `StoryMetrics`, `ActivitySparkline`, `Sentiment`, or `SummaryPending`. Their TSX files and dedicated selectors were removed. Other selectors with no references in the web app were removed: `rank`, `read-link`, `story-flair`, `method-note`, `header-note`, `source-links`, `source-note`, `story-actions`, `story-byline`, `related-story-date`, and `archive-pagination`. The active `SkepticismPill` and shared feed/story styles remain. `lib/story-metrics.ts`, `getStoryMetrics`, and Markdown/RSS metrics remain in use and were retained.

`globals.css` continues to own semantic colors, typography, spacing, widths, and the 2.75rem touch target. About and Topics now use page CSS modules. Discussion-analysis rules are scoped to its component root in a CSS module while retaining stable DOM class names for existing behavior and tests. Next bundles this module into a CSS chunk also loaded by fallback routes, so this particular extraction reduces cascade coupling but **does not** reduce their transfer. The deletions and route modules account for the measured transfer savings.

## Emitted production CSS

| Build | Emitted CSS files | Total raw | Total gzip, each file level 9 | Shared CSS in fallback HTML |
| --- | ---: | ---: | ---: | ---: |
| Baseline, inline | 2 | 48,614 B | 10,266 B | 48,614 B |
| Trimmed, inline | 4 | 41,993 B | 9,478 B | 40,337 B |
| Trimmed, external | 4 | 41,993 B | 9,478 B | 0 B |

The trimmed shared chunks are 28,739 B and 11,598 B raw. The About and Topics module chunks are 592 B and 1,064 B raw. The emitted total fell by 6,621 B raw (13.6%). The compiler may produce different hashes or byte totals in another build; these are local production build results.

## Full-document transfer

All numbers below are Chromium `transferSize` bytes for the HTML navigation plus CSS resources. Values in parentheses show `HTML + CSS`; repeated visits use the same browser context and therefore a warm CSS cache. The baseline and trimmed-inline builds had **zero** external CSS requests. The final external build had two shared CSS requests on a cold visit, plus one page CSS request for About or Topics.

| Route | Baseline inline: first / repeat | Trimmed inline: first / repeat | Final external: first / repeat |
| --- | ---: | ---: | ---: |
| `/` | 36,981 / 36,981 | 31,162 / 31,162 | 17,101 (7,764 + 9,337) / 7,764 (7,764 + 0) |
| `/archive` | 37,047 / 37,047 | 31,225 / 31,225 | 17,164 (7,827 + 9,337) / 7,827 (7,827 + 0) |
| `/category/agents-coding` | 36,783 / 36,783 | 30,961 / 30,961 | 16,874 (7,537 + 9,337) / 7,537 (7,537 + 0) |
| `/story/12345678` (fallback) | 37,033 / 37,033 | 31,208 / 31,208 | 17,139 (7,802 + 9,337) / 7,802 (7,802 + 0) |
| `/docs/api` | 38,327 / 38,327 | 32,458 / 32,458 | 18,250 (8,913 + 9,337) / 8,913 (8,913 + 0) |
| `/about` | 36,747 / 300 | 31,059 / 300 | 16,514 (6,285 + 10,229) / 300 (300 + 0) |
| `/topics` | 35,680 / 35,680 | 30,263 / 30,263 | 16,717 (6,596 + 10,121) / 6,596 (6,596 + 0) |

The 300 B repeat values for `/about` reflect Chromium's static HTML cache behavior. Dynamic pages did not cache their HTML. For example, the final build cut the cold homepage transfer by 14,061 B and a repeat full-document homepage visit by 23,398 B versus trimmed inlining.

## Paint check and inline-CSS decision

Seven fresh browser contexts per route gave these median first-contentful-paint values on localhost (Chromium desktop, 1280px, no throttling):

| Route | Trimmed inline | Trimmed external |
| --- | ---: | ---: |
| `/` fallback | 24 ms | 20 ms |
| `/docs/api` | 28 ms | 24 ms |
| `/about` | 20 ms | 20 ms |

One paint entry in each docs run was unavailable and excluded from that median. These very small local timings do not predict LCP on a real network or with populated data. External CSS adds two render-blocking requests on a cold shared route, or three on About/Topics. The lower measured first-load bytes, persistent stylesheet cache, and lack of a local FCP regression support disabling `inlineCss`; a browser performance budget and production field measurements remain the appropriate checks for a slower network. Client-side transitions were not included in this transfer table.

Focused `discussion-analysis` and `story-content` Jest suites passed (44 tests). The production build passed with the scoped modules. Final cross-route visual checks and the combined issue #148 browser suite are recorded separately.

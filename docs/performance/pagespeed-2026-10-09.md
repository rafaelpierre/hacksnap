# PageSpeed follow-up, 2026-10-09

The production report identified two render-blocking stylesheets, a 13.9 KiB
legacy-JavaScript estimate, and 26.6 KiB of unused JavaScript. The investigation
matched the reported hashes to the live assets and inspected Next.js 16.3.8.

## Font downloads

The layout registered Newsreader upright and italic even though no page styles
consumed its CSS variable. Both fonts appeared in HTTP 103 Early Hints and final
response preload headers. Direct downloads measured 131,848 and 147,060 bytes,
respectively: 278,908 bytes total. Removing the registration leaves Bricolage
Grotesque and Source Sans 3, whose files total 105,660 bytes. Font files remain in
the repository; this change removes unused browser loading, not stored assets.

The four production-fixture route budgets now count font response bodies and
unique font URLs, with limits of 115,000 bytes and two requests. Previously the
budgets counted JavaScript, CSS and images only. Reports also include document
response-start time and FCP separately from LCP. Local response-start measurements
must not be presented as production server latency.

## Framework JavaScript

The reported `02gxvhjb7giep.js` was 228,416 decoded bytes. Its polyfill assignment
offsets exactly matched the seven PageSpeed findings. The full polyfill module,
including additional compatibility helpers, occupied 1,376 raw bytes. Removing
that body in memory for a gzip comparison reduced the compressed chunk from
71,352 to 70,954 bytes. This 398-byte difference is an illustrative compression
measurement, not a modified production build.

[Lighthouse estimates legacy-JavaScript savings using core-js dependency sizes](https://github.com/GoogleChrome/lighthouse/blob/main/core/lib/legacy-javascript/legacy-javascript.js).
Those sizes do not measure Next's compact handwritten shims. Next imports the
module unconditionally; changing Browserslist does not remove it. The framework
polyfills remain intact. The same chunk includes Next bootstrap and React DOM,
so moving app sharing code does not eliminate its unused-JavaScript warning.

## CSS measurement considerations

Both reported stylesheet URLs already appeared in HTTP 103 preload hints and
share the document origin. Additional preload or preconnect tags would not solve
the report. The 1,042 ms initial navigation duration is not a TTFB measurement.

The earlier [CSS audit](issue-149-css.md) deliberately retained independently
cacheable stylesheets after measuring larger HTML with global CSS inlining.
Its unthrottled fallback-page tests did not predict slow-network behavior. This
follow-up uses populated fixtures when comparing CSS configurations. Production
PageSpeed results must be remeasured after deployment; estimated audit savings
are not measured improvements.

The graph chunking trial used `experimental.cssChunking` with `type: "graph"`,
`requestCost: 100000`, and `weightDistribution: 0.1`. A frozen fixture excluded
the font and share edits from this comparison (base revision `6c37920`). Three
fresh Chromium contexts per route each performed a cold navigation and a repeated
full-document visit.
Viewport was 390 by 844 at DPR 1, with CDP CPU slowdown 4x and requested network
conditions of 150 ms latency, 1.6 Mbps down and 750 Kbps up. A local forwarding
proxy served fixture images without Playwright interception, retaining HTTP
caching. The following rendering values are medians, not production predictions.

| Cold fixture metric | Existing chunking | Graph trial |
| --- | ---: | ---: |
| Homepage stylesheet URLs | 2 | 4 |
| Homepage CSS transfer, including response overhead | 8,284 B | 8,511 B |
| Homepage LCP | 640 ms | 824 ms |
| Story CSS transfer, including response overhead | 8,284 B | 9,161 B |
| Story LCP | 640 ms | 884 ms |

Both configurations transferred zero stylesheet bytes on repeat visits. Graph
chunking reduced homepage gzip CSS slightly but increased request count and
actual transfer; story gzip CSS also increased. The experiment was rejected.
Source configuration keeps the existing external stylesheet strategy.

## Deferred sharing controller

The initial share component now contains the trigger, loading status, retry and
module-loading state. Dialog, draft and clipboard handling move behind its first
open. The loaded controller remains mounted when closed to preserve drafts.
The larger editor and parser retain their separate deferred boundary. Clipboard
actions still execute from their own click handlers after the dialog has loaded.

Regression tests cover no import during server rendering or initial mount,
closing before an import resolves, a failed import followed by retry, Escape on
the actual focused control, updated props, and modal focus restoration. Existing
draft and clipboard tests continue to cover identity changes and stale results.

## Integrated validation

All four populated route budgets passed with 105,660 font bytes and two font
URLs. After incorporating the typography update from `de39446`, initial CSS was
33,648 decoded bytes / 7,467 gzip bytes. Homepage, month and category initial
JavaScript measured 544,169 decoded / 165,661 gzip bytes; the
story measured 524,807 decoded / 159,267 gzip bytes. These are final build totals,
not a controlled before/after JavaScript comparison. Inspecting the fetched
initial scripts confirmed that the sharing controller was absent; its content
exists in a separate generated chunk.

Validation passed: lint, formatting, TypeScript, production build without
database credentials, 434 unit/component tests, 134 Chromium browser tests and
8 iPhone WebKit history tests. Chromium includes sharing, keyboard focus,
accessibility, no-JavaScript routes, responsive layouts and asset budgets.

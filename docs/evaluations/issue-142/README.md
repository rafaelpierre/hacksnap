# Issue #142: responsive article image fixture

The browser matrix in [results.json](results.json) uses a deterministic 1600×900 WebP
source (425,666 bytes), thirty distinct local URLs with identical bytes, and the
real Next image optimizer. Its card markup uses the shared feed layout from #168.
The baseline uses the original single-source `<img>` with lazy feed loading and
eager detail loading. The optimized case uses the new `sizes`, bounded `srcSet`,
and high priority for the initial first card image after a simulated fresh-feed
restoration check, plus the detail image. Both cases reserve intrinsic 1600×900
dimensions. This is a **local fixed fixture**;
it contains no production traffic, origin latency, or Core Web Vitals data.

| Fixture  | Viewport / DPR | Selected optimized width | Image payload, baseline → optimized | LCP, baseline → optimized |   CLS |
| -------- | -------------- | -----------------------: | ----------------------------------: | ------------------------: | ----: |
| 10 cards | 360 / 1×       |                   320 px |                4,256,660 → 18,220 B |                96 → 64 ms | 0 → 0 |
| 10 cards | 360 / 3×       |                  1080 px |             4,256,660 → 1,196,120 B |                92 → 68 ms | 0 → 0 |
| 10 cards | 1280 / 1×      |                   320 px |                4,256,660 → 18,220 B |                92 → 60 ms | 0 → 0 |
| 10 cards | 1280 / 2×      |                   640 px |               4,256,660 → 269,400 B |                92 → 68 ms | 0 → 0 |
| 30 cards | 360 / 1×       |                   320 px |               12,769,980 → 54,660 B |                92 → 92 ms | 0 → 0 |
| 30 cards | 360 / 3×       |                  1080 px |            12,769,980 → 3,588,360 B |               112 → 96 ms | 0 → 0 |
| 30 cards | 1280 / 1×      |                   320 px |               12,769,980 → 54,660 B |               112 → 84 ms | 0 → 0 |
| 30 cards | 1280 / 2×      |                   640 px |              12,769,980 → 808,200 B |               116 → 84 ms | 0 → 0 |
| Detail   | 360 / 1×       |                   384 px |                   425,666 → 3,162 B |                32 → 36 ms | 0 → 0 |
| Detail   | 360 / 3×       |                  1080 px |                 425,666 → 119,612 B |                36 → 36 ms | 0 → 0 |
| Detail   | 1280 / 1×      |                   750 px |                  425,666 → 41,786 B |                36 → 36 ms | 0 → 0 |
| Detail   | 1280 / 2×      |                  1600 px |                 425,666 → 424,686 B |                36 → 36 ms | 0 → 0 |

Payload is the sum of image response bodies captured by Chromium, not a claim
about total page transfer. The card totals include scrolling through every card.
Before scrolling, Chromium fetched 10 of 30 card images at 360 px and 15 of
30 at 1280 px; the rest loaded on scroll. The fixture's first card starts lazy
in server HTML and becomes eager/high after the simulated fresh-feed restoration
check; a deep restored feed keeps it lazy, as tested separately. All 24 observed
LCP elements were an `IMG`. CLS stayed zero. The LCP times are single local Next
development server runs without network or CPU throttling; cold conversion, hot module reload,
and local caching affect them. They establish the LCP element and record the
requested before/after values, but do not establish a latency win. A separate
local optimizer request on a fresh fixture URL returned `MISS` in 43 ms and `HIT`
in 3 ms. These timings are illustrative of cold conversion and warm cache cost.

At DPR 2, breakpoint checks on the shared card CSS at 320, 360, 640, 641, 768,
800, 801, 1024, 1280, and 1440 px found a selected candidate at least twice
the displayed width and no horizontal overflow at normal text size. With 200%
root text size, no image candidate was undersized. At 801 px, the synthetic
footer's single unbreakable text span extended 8 px beyond the viewport; this
fixture does not reproduce the real card's separately wrapped metadata. The
desktop sidebar can make image columns much narrower, so the browser can
overselect a candidate at that scale.

To reproduce from the repository root, install the web dependencies and run:

```sh
cd hacksnap/web
node ../../docs/evaluations/issue-142/generate-fixture.cjs
mkdir -p app/perf-image
cp ../../docs/evaluations/issue-142/fixture-page.tsx app/perf-image/page.tsx
cp ../../docs/evaluations/issue-142/fixture-image.tsx app/perf-image/fixture-image.tsx
npm run dev -- --port 3202
```

In another shell in `hacksnap/web`, set `PLAYWRIGHT_MODULE` to an installed
Playwright module and run:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright node ../../docs/evaluations/issue-142/measure.cjs
```

The script writes a summary to `/private/tmp/issue142-summary.json` by default;
set `REPORT_PATH` to change it. Remove the temporary `app/perf-image` route and
`public/fixture-image-*.webp` files after measuring. Those fixture files are
deliberately absent from the application change.

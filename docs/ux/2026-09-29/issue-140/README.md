# Share editor loading review (#140)

The production build was compared with `27fdb65` (`origin/main` at the start of this work), using Node 22.23.3, Next.js 16.3.6 and macOS. Both builds used `npm ci && npm run build`. The numbers below sum the `entryJSFiles` for the home page (10 cards) and archive page (30 cards) in their production client-reference manifests. Gzip uses Node's `zlib.gzipSync` at its default settings. These are route-entry chunks, not all framework JavaScript fetched by a browser.

| Route fixture | Before raw / gzip | After raw / gzip | Gzip reduction |
| --- | ---: | ---: | ---: |
| 10-card home | 107,856 / 43,475 B | 36,797 / 14,003 B | 29,472 B |
| 30-card archive | 107,208 / 43,091 B | 36,263 / 13,861 B | 29,230 B |

Before, the synchronous parser-containing chunk was 84,291 B raw / 34,625 B gzip. After, `twitter-text` and the editor are in a 73,451 B raw / 30,478 B gzip async chunk absent from both route entries. The production browser fixture loaded 30 controls without requesting that chunk; first open requested it. This measures the whole chunks, not the standalone size of `twitter-text`.

A deterministic Jest/JSDOM fixture rendered 10 or 30 `ShareLinks` with sequential IDs, fixed titles and a fixed takeaway, then hydrated seven fresh roots per count. Median hydration time was 5.37 → 5.24 ms for 10 cards and 12.05 → 11.53 ms for 30 cards. One cold first-open sample per process was 15.1 → 70.5 ms for 10 cards and 14.2 → 99.9 ms for 30 cards. These local CPU timings include Jest module transformation on first import and are too small/noisy to claim a real-browser hydration improvement. The tradeoff is a smaller initial route bundle and a first-use load.

For a browser smoke check, a temporary production route rendered 30 identical controls with the normal page gutter. It ran on port 3140 in headless Chrome 154 with cache disabled. At 320px and 1280px, light and dark themes, and 100%/200% text, first open completed in 35–71 ms without throttling (one run per setting). A 700 ms simulated network latency yielded 1.34 s. Escape returned focus, outside dismissal worked, edited Unicode drafts survived close/reopen, clipboard denial selected the manual-copy field, and X showed the correct 304/280 weighted count. Blocking the editor chunk left Copy link, LinkedIn, Email, Copy suggested post, and Retry editor usable; unblocking and retrying loaded the editor. These are local smoke timings, not production latency measurements.

Screenshots: [loading at 320px](loading-320-light.png), [editor at 320px with 200% text](editor-320-dark-200.png), [failed load and retry at 320px with 200% text](failure-320-dark-200.png), and [desktop editor](editor-desktop-light.png).

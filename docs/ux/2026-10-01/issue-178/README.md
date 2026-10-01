# Browse navigation feedback — issue #178

Validation used Node 22, Chromium, and an isolated Next development server on
127.0.0.1:3178. The preview replaces only its copied data readers with five
synthetic stories and a fixed 1,800 ms delay. No database or production content
was accessed. These are functional responsiveness checks, not production latency
benchmarks. Screenshots include the Next development indicator.

## Results

- All 24 cases passed: Top stories, Latest, and category navigation at 320/1280px,
  light/dark, and 100%/200% root text size. No horizontal overflow, focusable
  placeholders, or skeleton animation with reduced motion.
- Final representative click runs showed skeletons after 84–110 ms; stories
  arrived after 1,869–1,917 ms. See `results.json` for the complete matrix.
- On the unchanged-main baseline with the same delayed readers, Latest remained
  visible at 339 ms after clicking Top stories, with no loading feedback;
  destination content arrived at 2,126 ms. Development timings vary and the
  difference in final-content times is not a query-performance claim.
- Holding the navigation response displayed the clicked link's pending indicator.
  It cleared after navigation. Back/Forward passed.
- Keyboard Enter opened another category and showed that category's heading with
  skeletons. A synthetic modified click did not start pending navigation.
- Seven invalid route/date/page cases returned HTTP 404. Unit tests additionally
  cover empty later pages, invalid cursors, deferred outages, and read ordering.
- With JavaScript disabled, all five story links remained visible on each of the
  three full-document feeds. Primary skeleton streaming is deliberately limited
  to browser fetch requests (`Sec-Fetch-Dest: empty`); document requests or clients
  lacking Fetch Metadata retain blocking server rendering.
- No page errors occurred. Lint, formatting, TypeScript, production build, and all
  295 tests (55 suites) passed. The production build needed no database credentials.

## Reproduce

Run from the repository root after installing the locked frontend dependencies
with Node 22. Supply an absolute preview path outside the checkout:

```sh
python3 docs/ux/2026-10-01/issue-178/prepare-preview.py "$PWD" /private/tmp/hacksnap-178-preview
cd /private/tmp/hacksnap-178-preview
npm run dev -- --webpack --hostname 127.0.0.1 --port 3178
```

In another terminal, run `verify-browser.cjs` and `verify-keyboard.cjs` from this
directory with Node. They use an installed Playwright module; set
`PLAYWRIGHT_MODULE` to its absolute module path if it is supplied by external
workspace tooling. Chromium must already be available to Playwright. Output goes
to `/private/tmp/178-browser-evidence`. The fixture is intentionally development
only and is never copied into the production tree. Stop the preview afterwards.

## Limits

No production cold-start, database, or network measurements were collected.
Refresh latency remains part of #170. No live screen-reader or additional-browser
verification was performed. Browser checks cover navigation and restored pages;
existing unit tests cover detailed story-return and scroll restoration behavior.

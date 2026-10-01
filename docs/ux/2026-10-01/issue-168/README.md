# Shared story cards — issue #168

Top Stories (`/`), Latest (`/archive`) and the Agents & Coding topic
(`/category/agents-coding`) all render the same `StoryRow`. Before and after
screenshots confirm the shared card styling in each route. The visible card
layout stays consistent; the change makes its document order match the visual
order and removes the old row layout rules that could override the feed grid.
Top Stories retains its Archive label for older ranked stories.

The screenshots use five synthetic stories, a locally intercepted 1200 × 675
SVG for the first card and no database or remote image requests. The sticky site
header and Next development indicator are hidden only in the card crops so the
full card remains visible at 200% text. The geometry matrix ran on all three
routes at 320px and 1280px, in light and dark themes, at 100% and 200% text
(24 combinations before and after). Every document matched the viewport width;
the loaded image retained its proportions; title, image, excerpt and footer did
not overlap. At 320px, the title, image, excerpt and footer followed the same
reading order in each route.

The complete recorded matrices are available as [before](results-before.json)
and [after](results-after.json) JSON files. The after matrix includes the final
separator styling. The reusable [preview preparer](prepare-preview.py) and
[capture script](capture-matrix.cjs) are included here.

## Before and after

All screenshots use 200% root text size and the light theme. The full matrix also
checked the dark theme and normal text size.

| Feed        | 320px before                                | 320px after                               | 1280px before                                | 1280px after                               |
| ----------- | ------------------------------------------- | ----------------------------------------- | -------------------------------------------- | ------------------------------------------ |
| Top Stories | [before](screenshots/before/top-320.png)    | [after](screenshots/after/top-320.png)    | [before](screenshots/before/top-1280.png)    | [after](screenshots/after/top-1280.png)    |
| Latest      | [before](screenshots/before/latest-320.png) | [after](screenshots/after/latest-320.png) | [before](screenshots/before/latest-1280.png) | [after](screenshots/after/latest-1280.png) |
| Topic       | [before](screenshots/before/topic-320.png)  | [after](screenshots/after/topic-320.png)  | [before](screenshots/before/topic-1280.png)  | [after](screenshots/after/topic-1280.png)  |

## Reproduction

From the repository root, after `npm ci` in `hacksnap/web`, prepare the existing
synthetic route fixture and start it on an unused port:

```sh
python3 docs/ux/2026-10-01/issue-168/prepare-preview.py "$PWD" /private/tmp/hacksnap-168-preview
cd /private/tmp/hacksnap-168-preview
npm run dev -- --webpack --hostname 127.0.0.1 --port 3196
```

The fixture-only copy of `lib/data.ts` marks its first card with a ready
canonical Blob URL and image dimensions `1200 × 675`; the capture script locally
answers that URL with an SVG of the same dimensions. It also makes the fifth
story's summary pending. Neither fixture change reaches the app source or a
remote image service.

Run the matrix from the repository root with Node 22 and a Playwright module:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
BASE_URL=http://127.0.0.1:3196 \
EVIDENCE_DIR=/private/tmp/hacksnap-168-evidence \
node docs/ux/2026-10-01/issue-168/capture-matrix.cjs
```

The script accepts `BASE_URL`, `EVIDENCE_DIR`, and `PLAYWRIGHT_MODULE`. Set
`CAPTURE_ONLY=1` for the six light-theme 200% screenshots; otherwise it checks
both themes and both text sizes and saves measurements to `results.json`.

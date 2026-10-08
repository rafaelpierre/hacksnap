# Top-bar navigation

Latest and About are visible in the header on every route. The desktop sidebar
and mobile Topics disclosure contain only topic destinations. The active main
destination has a blue underline and `aria-current`; topic-filtered feeds retain
their topic selection and clear Latest. Dated feeds mark Latest as a location.

## Design decisions

Reading this as an editorial news reader for technical readers, using the existing
approved Bricolage/Source Sans, white-header and blue-accent direction.
ENERGY 2 / RHYTHM 2 / MOTION 1, inherited from the frontend revamp.

- Group Latest and About beside the wordmark to make global destinations predictable.
- Keep both links visible on phones to remove the menu-opening step.
- Use an underline for current location so selection does not depend on color alone.
- Keep topic filters together in the sidebar or labelled Topics disclosure.
- Reuse the normal-flow header so enlarged text and open topics push content down.
- Below 38rem, use a second row; at very narrow container widths, give Topics its own row.
- At enlarged text sizes, reduce panel padding and hide redundant decorative topic icons to preserve label width.
- Reuse existing fonts, neutral colors, spacing and 44px controls for visual continuity.
- Keep the existing pending indicator and reduced-motion behavior for navigation feedback.

## Evidence

Screenshots use the repository's deterministic browser fixtures. Story text,
counts, dates and imagery in these captures are test data, not production claims.

- [Desktop, 1440px](desktop.png)
- [Tablet, 768px](tablet.png)
- [Mobile, 320px](mobile.png)
- [Mobile, 320px at 200% text with Topics open](mobile-200-percent.png)

Validation used Node 22.23.3:

- `npm ci`: success, zero reported vulnerabilities.
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build`: pass.
- `npm run test:ci`: 74 suites, 414 tests passed; the two affected suites (7 tests) also passed after the final navigation logic change.
- `BROWSER_PORT=3118 npm run test:browser -- top-bar-navigation.spec.ts journeys.spec.ts article-sidebar.spec.ts --project=chromium`: 49 passed on the final build.
- `git diff --check`: pass.

The initial no-JavaScript run exposed a duplicated disclosure from a Suspense
fallback. Keeping the native disclosure outside that boundary fixed it. An
existing share-dialog focus test failed once on a subsequent parallel run and
passed without changes in the final 49-test run. Browser validation here covers
Chromium; Safari and Firefox were not run locally.

Click-through evidence: Latest opens `/` and clears topic filtering; About opens
`/about`; Browse by topic opens `/topics`; category links open their real query
destinations; Topics expands inline, closes on selection and Escape, and restores
summary focus. Latest also closes an open menu on query-only navigation. Back and
Forward restore selected destinations. Latest, About and topic links also work
without JavaScript. Keyboard order is wordmark, Latest, About, then Topics on
mobile. Existing article/sidebar, loading, empty, failed and storage-blocked
journeys pass.

## Delivery gate

This gate applies to the changed navigation and its shared layout, rather than
claiming a new audit of every existing product feature. All results below are PASS.

| Check | Evidence |
| --- | --- |
| R-02 copy | New UI copy consists of the established Latest, About and Topics labels; no em dashes added. |
| R-03 mobile | 320/768/1440px at 100% and 200% text: no overlapping header controls or page overflow; all targets at least 44px. |
| R-17 numbers | No product numbers added; screenshot data is explicitly labelled as fixtures above. |
| R-18 testimonials | No testimonials added. |
| R-23 assets and navigation | User requested this navigation relocation; no new visual assets or destinations created. |
| R-24 destinations | Click-through confirms existing `/`, `/about`, `/topics` and category destinations. |
| R-25 contrast | Header text on white 9.18:1; active blue on white 8.59:1; focus on pale blue 9.78:1; Topics border on white 3.65:1 (non-text threshold 3:1). Axe reports no header violations. |
| R-26 function | Links navigate, Topics opens and closes, and route selection follows history. |
| R-27 states | Existing pending links retained; unit pending-status assertions and browser loading, empty and unavailable journeys pass. |
| R-28 FAQ | No FAQ added. |
| R-32 keyboard | Tab order, focus outline, Enter navigation and Escape focus return verified. |
| R-33 source edits | Components and CSS edited directly with patches; no source-rewriting helper introduced. |
| R-34 themes | Approved fixed light palette retained; no new appearance state. |
| R-35 execution | Production build, recorded click-through and final 49 browser tests pass. |
| R-36 claims | No security, performance or customer claims added to the UI. |
| R-37 direction | Existing approved revamp direction and explicit design read documented above. |
| R-38 content | Existing real destinations and labels reused; captured fixture content labelled. |
| R-01 color | Existing blue marks current location and interaction; no gradients introduced. |
| R-04 icons | Latest/About need only text; existing topic icons remain where space permits. |
| R-06 typography | Existing Source Sans UI text and Bricolage wordmark retained. |
| R-07 background | Existing white header retained without pattern or texture. |
| R-08 arrows | No decorative arrows added. |
| R-09 badges | No badges added. |
| R-10 glass | No blur or glass added. |
| R-12 shadow | No shadows added. |
| R-13 glow | No glow added; standard focus outlines retained. |
| R-14 cards | No feature cards added or changed. |
| R-19 motion | Only existing hover feedback and pending indication; reduced-motion behavior retained. |
| R-22 illustrations | No product illustrations added. |
| Liveliness dials | ENERGY 2 / RHYTHM 2 / MOTION 1 specified and consistent with the inherited reader. |
| Liveliness focal point | Saved desktop/mobile captures retain the lead story as the main content emphasis. |
| Liveliness spacing | Header gap groups main destinations; separate topic navigation establishes scope. |
| Liveliness accent | Blue underline identifies the current destination. |
| Liveliness identity | Existing wordmark, Bricolage headlines and Source Sans UI retain product identity. |
| Liveliness design read | Recorded before implementation and repeated above. |
| C-1 intent | Each major decision is documented above. |
| C-2 completeness | Native links and disclosure pass with and without JavaScript. |
| C-3 content | Only requested destinations and existing topics occupy navigation. |
| C-4 resilience | Responsive, enlarged-text, keyboard, history and no-JavaScript cases pass. |
| C-5 evidence | No fabricated claims; captures are explicitly identified as fixtures. |
| R-05 structure | Global navigation and topic navigation follow their actual purposes. |
| R-11 radius | Existing control and card radius tokens retained. |
| R-15 CTAs | Specific destination names retained. |
| R-16 language | No marketing copy added. |
| R-20 identity | Existing approved colors, typography and wordmark retained. |
| R-21 appearance | Existing fixed light direction retained. |
| R-29 palette | Existing neutrals and single blue accent retained. |
| R-30 originality | This is a scoped change to the approved product, with no new visual reference copied. |
| R-31 reasons | Color, typography, spacing, layout and icon decisions documented above. |

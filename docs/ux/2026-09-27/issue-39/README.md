# Issue 39: discussion themes and stance highlights

## Verification

Rendered the real `StoryContent` component to static HTML using the shared JSON
fixtures, application CSS, and bundled fonts. Served the disposable HTML on
localhost for Chrome checks. No live database or generated analysis was used;
the static fixture does not exercise Next routing, hydration, or Share controls.
The new discussion UI is server-rendered and uses native details and links.

- Checked 320px and 1280px widths, Light and Dark, at 100% and 200% root text size.
- No horizontal overflow in all eight combinations. Groups stack on narrow
  screens and at enlarged text sizes. New source links and disclosures meet the
  shared 44px minimum target. See `browser-results.json`.
- Focused a theme summary and sent Enter; the disclosure opened. Tab then reached
  its cited source link, with the accessible name “Read HN comment 101: Unequal
  benchmark conditions” and a visible 2px outline. No JavaScript was loaded.
- Checked both groups, each one-sided case, topics-only, no-comments,
  insufficient-context and legacy-null fixtures at 320px. See
  `fixture-results.json`. Legacy fixtures retain their original cited points.
- Shared-fixture unit tests also cover sarcasm, replies that disagree with a
  critic, qualified support, ethical concern, multiple claims and HN text posts.

## Screenshots

- [Desktop, both groups](both-groups-desktop.png)
- [320px, light](320-light-100.png)
- [Desktop, dark](1280-dark-100.png)
- [320px, dark, 200% text](320-dark-200.png)
- [No usable comments](no_comments-320-dark.png)
- [Insufficient source context](unavailable_source-320-dark.png)

Additional screenshots cover all eight width/theme/text combinations. They use
synthetic story copy and shared analysis fixtures; they are not production data.

## Automated checks

Node 22; `npm ci`, `npm run lint`, `npm run format:check`, `npm run test:ci`
(117 tests), `npm run typecheck`, and `npm run build` pass. Build runs without
database credentials. `git diff --check` passes.

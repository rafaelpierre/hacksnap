# Article sidebar and typography

Article pages now reuse the feed's responsive layout and optional Most read card.
The sidebar stays at the same desktop horizontal position when a reader opens a
story, and follows the article below 78rem. Popularity loads independently, so a
slow or failed read cannot hide the article during client navigation. Full-document
requests await the popularity result so ordinary links and terminal states remain
visible without JavaScript. Source Sans 3 replaces Newsreader in
article paragraphs and key points, matching the byline as requested.

Design direction follows the existing DEV implementation: Bricolage headlines,
Source Sans text, white reading surfaces and blue links. No assets or visual
patterns were added. Energy 2, rhythm 2, motion 1 retain the existing hierarchy,
section spacing and interaction-only transitions.

## Verification

- PASS: lint, formatting, TypeScript and credential-free production build.
- PASS: all 74 Jest suites, 401 tests, including stalled and failed popularity reads
  and blocking document responses.
- PASS: eleven article browser checks covering 320px/1440px at 100%/200% text,
  computed paragraph and key-point fonts matching the byline, no horizontal
  overflow, sidebar placement, 44px link targets, and empty/failure states.
- PASS: JavaScript-disabled document requests expose populated, delayed, empty
  and failed popularity results. Ordinary sidebar links navigate to another story.
  The populated and delayed regressions failed against the original PR build,
  reproducing the review finding before the streaming split was applied.
- PASS: axe WCAG A/AA checks for all four layouts, with no browser console or
  hydration errors reported by the browser harness.
- PASS: feed headline opens an article with the sidebar; keyboard Enter on a
  sidebar link opens another article; Back returns through article and feed;
  Forward restores the article with the sidebar.
- PASS: 12 existing Chromium/iPhone WebKit history scenarios covering redirects,
  slow responses, saved topic/feed depth, explicit return, Back and reload.
- PASS: scoped design checks reuse the approved colors, hierarchy and components;
  the new sidebar uses existing loading, empty and failure messages. These are
  local fixture checks, not a production-data or full-site accessibility audit.

The local test server reported a canceled destination stream during navigation;
the browser console and hydration checks passed.

## Screenshots

Screenshots use the existing synthetic browser fixture, not production articles.

| View | Normal text | 200% text |
| --- | --- | --- |
| Desktop | [1440px](desktop.png) | [1440px](desktop-200.png) |
| Mobile | [320px](mobile.png) | [320px](mobile-200.png) |

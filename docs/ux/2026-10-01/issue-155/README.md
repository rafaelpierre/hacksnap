# Opened story title browser validation

Issue #155 was checked in Chrome with a temporary local Next.js fixture rendering the production `StoryFeed` and `StoryVisit` components with four synthetic stories. The first story was opened through a detail visit, then the browser returned to the feed. The fixture routes were removed before the final build and commit; no production database or credentials were used.

The [desktop light](desktop-light.png), [320px dark](mobile-dark.png), [desktop dark at 200% text](desktop-dark-200.png), and [320px light at 200% text](mobile-light-200.png) captures compare the slightly muted first title with unchanged unopened titles. No Seen or Opened labels, history controls, or feed filters appear. The preview headings and story content are synthetic.

All eight combinations of 320px/1280px viewport, light/dark appearance, and 100%/200% root text had no horizontal overflow. Exactly one title had the opened style in each case. Hover and keyboard focus return the opened title to the normal ink color; the existing focus outline remains. Storage migration, blocked-storage fallback, and missed cross-tab writes while a feed is unmounted have automated regression coverage.

These checks use desktop Chrome with a mobile-width viewport, not a physical touch device or manual screen-reader session. The local production database was unavailable; the real build and full test suite passed without database credentials.

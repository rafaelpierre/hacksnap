# Seen and opened history browser validation

Issue #155 was checked in Chrome against a temporary local Next.js fixture rendering the production `StoryFeed` and `StoryVisit` components with eight synthetic stories. The fixture routes were removed before the final build and commit; no production database or credentials were used.

The [desktop light](desktop-light.png), [320px dark](mobile-dark.png), [desktop dark at 200% text](desktop-dark-200.png), and [320px light at 200% text](mobile-light-200.png) captures show the muted Seen/Opened labels beside the existing category context. The preview headings and story content are synthetic. No history controls appear in the feed.

All eight combinations of 320px/1280px viewport, light/dark appearance, and 100%/200% root text had no horizontal overflow. The labels remained readable and wrapped beneath the category when the 200% mobile layout had no room on the same line. A valid detail visit recorded Opened, and browser Back displayed it on the feed. The foreground exposure threshold, storage migration, and blocked-storage fallback are covered by deterministic component tests.

These checks use desktop Chrome with a mobile-width viewport, not a physical touch device or manual screen-reader session. The local production database was unavailable, so browser navigation used synthetic stories; the real build and full test suite passed without database credentials.

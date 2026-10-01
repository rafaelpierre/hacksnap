# Seen and opened history browser validation

Issue #155 was checked in Chrome against a temporary local Next.js fixture rendering the production `StoryFeed` and `StoryVisit` components with eight synthetic stories. The fixture routes were removed before the final build and commit; no production database or credentials were used.

The [desktop light](desktop-light.png), [320px dark](mobile-dark.png), and [desktop dark at 200% text](desktop-dark-200.png) captures show the history control and visible Seen/Opened labels. The preview headings and story content are synthetic.

All eight combinations of 320px/1280px viewport, light/dark appearance, and 100%/200% root text had no horizontal overflow. The Hide seen label and Clear viewing history button measured 44px tall at normal text size and 88px at 200% text. Native checkbox activation and keyboard Tab focus were verified; the focus ring stayed visible at 320px and enlarged text. Clearing history announced completion, returned focus to Hide seen, and revealed filtered cards. Hide seen persisted after reload. A valid detail visit recorded Opened, and browser Back displayed it on the feed. The timed exposure and bounded continuation cases are covered by deterministic component tests.

These checks use desktop Chrome with a mobile-width viewport, not a physical touch device or manual screen-reader session. The local production database was unavailable, so browser navigation used synthetic stories; the real build and full test suite passed without database credentials.

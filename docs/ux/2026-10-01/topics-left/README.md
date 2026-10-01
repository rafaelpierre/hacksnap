# Left topic navigation

The shared home, archive and category sidebar now precedes the feed in both DOM
and desktop grid order. Each destination has a decorative Lucide icon; text labels
and the active destination indicator remain. Links use the shared 44px target.

Validation: Node 22, npm ci, lint, format check, all 236 tests across 44 suites,
typecheck, production build, and git diff --check passed.

Browser inspection used the production build at 1280px and 320px in light and
dark themes, at normal and 200% root text size. Desktop icons remain visible,
labels wrap, and links have at least 44px targets (88px with enlarged text).
The sidebar stays hidden at mobile widths. Normal-size pages and desktop enlarged
text have no horizontal overflow.

No database credentials were configured, so captures show the existing unavailable
state. Loaded/empty feed content and navigation through live stories were not
verified. At 320px with 200% text, the existing unavailable-state heading overflows
its narrow text container; the sidebar is hidden in that case.

- [Desktop light](desktop-light.png)
- [Desktop dark](desktop-dark.png)
- [Mobile light](mobile-light.png)

## Skip navigation follow-up

Browse pages expose a focusable `#browse-content` target after the sidebar. CSS
selects the native skip link for that target when present; other pages retain the
`#main` target. Only one skip link participates in keyboard navigation. Both
containers use `tabIndex={-1}` so activating the anchor moves keyboard focus.

The repeatable browser regression script `check-skip-navigation.py` passed all
eight combinations of home/About, desktop/mobile, and JavaScript enabled/disabled.
It checks the first Tab reaches the appropriate skip link, Enter focuses its
content target, and the following Tab bypasses sidebar and header navigation.
Lint, formatting, all 236 tests, typecheck and the production build passed again.

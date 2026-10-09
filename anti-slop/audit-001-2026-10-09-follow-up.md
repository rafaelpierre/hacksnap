# Widget gutters and plain headings: approved changes resolved

The user approved the 9 October spacing finding and subsequently requested removal of both number badges and heading icons. This report covers that final scope for Trending and Most read.

## Change and purpose

- Headers, story rows, status messages and loading placeholders use a 1rem horizontal inset instead of 1.5rem.
- Heading icons and numbered badges are removed. Headers and story titles share the same left edge. Ordered-list semantics and ranking order remain intact.
- At content widths of 17rem or less, the existing 0.5rem compact inset also applies to status messages and loading placeholders.
- At a normal 16px root size in a 288px card, headline capacity increases from 202px to 254px. The headline starts 16px from the inner edge instead of 60px.

Reason: recover reading width within narrow ranking cards and align headings with their content, while preserving balanced card edges and separation from the feed.

Direction: retain the existing editorial cards, Bricolage headings, Source Sans UI, pale canvas and blue accents. ENERGY 2 / RHYTHM 1 / MOTION 1. No new assets or content.

## Verification

- Node 22, `npm ci`: completed, zero reported vulnerabilities.
- Lint, formatting, typecheck and production build: passed.
- Unit suite: 77 suites, 446 tests passed.
- Existing popularity browser suite: 15 tests passed. Widths 320, 393, 768, 820 and 1440, each at 100% and 200% text; no horizontal overflow, targets at least 44px high, focus checks and zero axe WCAG A/AA violations.
- Loading, empty, weekly failure and full failure scenarios passed. Feed stays available; slow loading remains below the layout-shift threshold.
- JavaScript-disabled Most read navigation and keyboard activation passed. Browser suite reports no browser console/hydration errors. The fixture server logged two expected image-optimizer failures for its deliberately non-live image URL in the JavaScript-disabled scenario; these did not fail the suite.
- Final screenshots confirm plain headings, badge-free story rows and aligned left edges. Source inspection confirms 16px horizontal padding and 254px available headline width in a 288px card.

Manual widget navigation record from the initial spacing verification, using the local fixture application. Numbered positions below identify list entries; badges have since been removed. The final browser suite reran keyboard and JavaScript-disabled navigation after the removals.

| Widget control | Action | Verified destination |
| --- | --- | --- |
| Trending rank 1 | Click | /story/91000006 |
| Trending rank 2 | Click | /story/91000007 |
| Trending rank 3 | Click | /story/91000008 |
| Trending rank 4 | Click | /story/91000009 |
| Trending rank 5 | Click | /story/91000010 |
| Most read rank 1 | Click | /story/91000001 |
| Most read rank 2 | Click | /story/91000002 |
| Most read rank 3 | Click | /story/91000003 |
| Most read rank 4 | Click | /story/91000004 |
| Most read rank 5 | Enter | /story/91000005 |

The final link was activated by keyboard after the browser automation could not click its offscreen position in the sticky sidebar at the inspection viewport. Its destination rendered the expected story heading. This change does not alter sticky positioning.

## Delivery gate for the approved change

- Hard gates PASS: no new prose, assets, claims or controls; existing links activate; browser matrix covers overflow, target size, focus, contrast and data states. Fixed light appearance is the only shipped theme. CSS was edited directly and the app was built and run.
- Purpose gates PASS: tighter insets and removal of optional icons/badges serve the recorded reading-width and alignment rationale. Colors, typography, cards and motion retain the established design.
- Liveliness PASS: declared ENERGY 2 / RHYTHM 1 / MOTION 1 retained; the feed remains primary, ranked widgets remain secondary, blue accents and heading treatment remain consistent. Whitespace separates content while leaving more room for headlines.
- Craftsmanship and quality PASS: same shared component and tokens serve both widgets; loading and status insets follow the rows; responsive and enlarged-text checks pass. No new sections, fabricated content or interaction behavior.

This gate is scoped to the approved widget simplification, not a claim of a new whole-site audit.

## Screenshots

These screenshots use the repository's synthetic browser-test fixtures, not live editorial content. The blue outline demonstrates keyboard focus.

- [Desktop, 1440px](../docs/ux/2026-10-09/widget-gutter/desktop.png)
- [Mobile, 320px](../docs/ux/2026-10-09/widget-gutter/mobile.png)
- [Mobile, 320px at 200% text](../docs/ux/2026-10-09/widget-gutter/mobile-200.png)

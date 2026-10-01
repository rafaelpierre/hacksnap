# Issue 156: in-session story updates

Real Chrome checks used the production `StoryFeed` component in a local Next.js preview with synthetic story data. The fixture began with five eligible stories, returned the same IDs in a new rank order, then returned a selection with one extra ID. No production data or fixture route is committed.

At 320px and 1280px widths, in light and dark themes, at 100% and 200% text size, the check confirmed that rank-only changes did not show the pill; the extra selection ID showed **Show new stories** without moving cards or scroll; the button stayed inside the viewport and met a 44px minimum target; keyboard Enter replaced the selection and focused a visible first story title. The refresh returned to the top when that title was already visible, and scrolled to reveal it at 320px/200% text. All eight cases had no page errors. Results are in [browser-results.json](browser-results.json).

Representative screenshots: [mobile pill at 200% text](banner-mobile-200.png), [desktop pill](banner-desktop.png), [mobile after refresh](refreshed-mobile-200.png), and [desktop after refresh](refreshed-desktop.png).

These browser checks use controlled selections. Database selection behavior and API failures are covered by the automated tests.

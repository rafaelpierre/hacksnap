# Sticky navigation verification

Verified in a fresh Codex in-app browser against a temporary local route containing
30 synthetic stories and the real header, topic sidebar, story cards, and feed.
The fixture route was removed before the production build. Screenshots were
refreshed after rebasing onto main’s left-sidebar layout (d266caa), preserving
its topic icons, DOM order, 44px link targets, and focusable skip destinations.

- 1440 × 900 and 320 × 740, light and dark themes, normal and 200% text.
- Header remains at the top after scrolling multiple screens. Desktop sidebar
  remains below the measured header; mobile uses the header's Topics link.
- At 200% text the desktop header measured 153px and sidebar started at 201px.
  The mobile header was capped to 370px and remained scrollable. Neither viewport
  had horizontal document overflow.
- Exact timestamp opens with Enter and has a visible focus outline. Skip to content
  remains visible above the sticky header, focuses `#browse-content`, and scrolls
  content below it. The next Tab enters the story list, bypassing the left sidebar.
- Component tests cover header resize/cleanup, stopping automatic observation on
  continuation focus, cancellation of an in-flight automatic response, manual
  loading while focused, failure preservation, and return-list restoration.

Screenshots use synthetic story titles. The Next.js development indicator is not
part of the production UI. Real touch-device and production-data testing were not
performed.

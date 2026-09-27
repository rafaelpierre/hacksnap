# Issue 40 visual checks

Rendered the real StoryRow component with synthetic stories, the shared stylesheet
and bundled fonts. Fixtures cover linked stance evidence, topics without stance
evidence (including a long unbroken title), legacy analysis, and no comments.

Checked Chrome at 320px and 1280px, light and dark themes, and 100% and 200% root
text size. All eight combinations had document width equal to viewport width.
The debate link measures 44px high at normal text size and 88px at 200%.
Keyboard tab order reaches category, headline, debate, then footer controls;
the debate link has a visible focus outline.

The existing skepticism pill text extends beyond its border at 320px / 200%
text, including legacy cards. The new preview does not overlap footer controls.

These are static, server-rendered component fixtures, not live database pages.
Client routing and return context are covered by the navigation component suite;
a live browser back/forward journey was not exercised. Existing story-content
tests verify the destination's discussion-analysis anchor.

- [Desktop, light](desktop-light.png)
- [Mobile, light](mobile-light.png)
- [Mobile, dark, 200% text](mobile-dark-200.png)

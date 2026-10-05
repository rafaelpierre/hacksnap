# Popular stories sidebar review

The homepage shows up to five stories ranked by lifetime story-page views.
On wide layouts, **Most read · All time** occupies the right column; narrow
layouts and enlarged text put the compact list above the Latest feed. The
compact feed has no visible introductory header. Dated feeds, category and
story pages keep their existing layout; legacy `/archive` URLs redirect to Latest.

The screenshots use the credential-free browser fixtures, a dark OS preference,
and the fixed light site theme. The first popular-story link has keyboard focus
so its focus outline can be reviewed:

- [Desktop, 100% text](home-1440-100.png)
- [Desktop, 200% text](home-1440-200.png)
- [320px phone, 100% text](home-320-100.png)
- [320px phone, 200% text](home-320-200.png)

`hacksnap/web/e2e/popular-stories.spec.ts` verifies full titles, public story
links, five entries, minimum 44px link targets, keyboard focus, horizontal
overflow, responsive position and WCAG A/AA automated checks. A deliberately
slow popularity read leaves the main feed available and stays within the
existing 0.1 CLS budget. A failed read leaves a useful feed and an independent
unavailable message. Keyboard story activation emits a separate click event;
mount and reload emit story-view events with distinct route IDs.

The sidebar uses a container query based on the container's computed font size
to avoid squeezing the main feed when readers enlarge text. The scrollable
desktop sidebar reserves inline padding for the full keyboard focus outline.
These checks do not replace a manual screen-reader review.

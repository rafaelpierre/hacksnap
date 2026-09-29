# Compact feed cards

Cards omit discussion themes and the “Read the debate” link. Desktop images fill
the adjacent content height with centered cropping; mobile images use a 16:9 frame.

The actual StoryRow and BrowseLayout components were rendered to static HTML with
public feed examples, bundled fonts, and the repository stylesheet. Skepticism
values and ranks are illustrative fixture values. No live database was used.

Browser checks covered full-width and sidebar feeds at 320px, 768px and 1280px,
both light and dark themes, and 100% and 200% root text size. All 24 combinations
had no horizontal overflow, no discussion preview, images using cover, and footer
links/buttons at least 44px high. Standard desktop images matched their content
height (140px in the full-width fixture). Mobile images measured 256 by 144px.
Missing images and pending copy also rendered without an empty image frame.

Static previews do not exercise hydration, image-error events, or interactive
sharing. The component suite covers image failures and existing navigation/share
behavior; those interactions were not manually retested in the static preview.

Validation: Node 22, npm ci, lint, format check, all 205 tests in 36 suites,
typecheck, production build, and git diff --check passed.

![Desktop, light](desktop-light.png)
![Desktop, dark](desktop-dark.png)
![Mobile, light](mobile-light.png)
![Mobile, dark with enlarged text](mobile-dark-200.png)

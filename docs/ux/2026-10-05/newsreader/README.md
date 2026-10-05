# Newsreader story typography

Story headlines, card excerpts, introductory text, article and discussion copy,
pending-story copy, and related-story headlines now use local Newsreader variable
fonts. Both upright and italic faces support weights 200–800 and optical sizes
6–72. Headlines use weight 600, reading text uses weight 400, and browser optical
sizing follows the rendered text size. Headline tracking is -0.02em on story
pages and -0.01em on cards.

The wordmark and general page headings retain Bricolage Grotesque. Navigation,
labels and metadata retain Source Sans 3. Reading widths, sizes, line heights,
light-only appearance and control targets remain the existing shared values. Social
previews use static Newsreader instances for headlines and excerpts; the brand
and metadata keep their existing fonts. All font requests remain local.

## Verification

The production fixture application renders the actual frontend with synthetic
stories, discussion data and images, without database credentials or live HN
requests. The complete production browser suite passed: 34 tests, including
320px and 1280px widths, light and dark OS settings, and 100% and 200% text size.
The interface stays light under both OS settings, including with an old saved
dark preference, preserving main's removal of the appearance control and script.
These checks cover horizontal overflow, bounded reading widths, keyboard/focus
behavior, no-JavaScript reading, responsive images, WCAG accessibility scans,
external-request errors, and the unchanged asset/rendering budgets.

All 64 unit/component suites (341 tests), lint, formatting, typechecking, and the
production build passed with Node.js 22.23.3. The built social preview was also
visually inspected.

## Screenshots

| Surface | Desktop | Mobile |
| --- | --- | --- |
| Story page | [Screenshot](story-desktop-light.png) | [Screenshot](story-mobile-light.png) |
| Story cards | [Screenshot](feed-desktop-light.png) | [Screenshot](feed-mobile-light.png) |

[Built social preview](social-preview.png)

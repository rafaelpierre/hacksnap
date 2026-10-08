# Trending and Most read widget verification

Reading this as: an editorial news feed for AI readers, retaining Hacksnap's
serif headlines, quiet metadata, white page and copper interaction accent.
Dials: ENERGY 1 / RHYTHM 1 / MOTION 1.

Trending this week appears above Most read. Each shows five canonical story
links on wider screens. Both disappear at the existing 50rem mobile sidebar
breakpoint. Most read omits the All time label while retaining lifetime ranking.
Trending counts first-party views during the last 168 hours, including old
articles read recently. Historical GA totals and clicks do not enter that list.

The screenshots use explicitly artificial browser fixtures, not production
stories or view totals. Tests cover 320, 393, 768, 820 and 1440px widths at
100% and 200% text size. The image assets come from the existing fixture harness.

Design reasons:

- Two visible lists expose both discovery paths without an extra selection.
- Trending leads because current reading activity is more useful to returning readers.
- Headings, ranked lists and dividers reuse the site's established editorial structure.
- Existing serif titles, sans labels and semantic colors retain visual continuity.
- The mobile breakpoint keeps Latest at the top and matches topic navigation.
- Independent optional reads preserve the main feed and the other widget during outages.
- Full document requests return readable HTML; client navigation retains streaming.

Validation records are in the PR. Browser coverage includes stacked order,
phone hiding, full titles, canonical URLs, 44px targets, keyboard focus,
WCAG AA axe checks, empty/error states, slow optional reads, no-JavaScript
navigation, first-party tracking and Chromium/iPhone WebKit history restoration.

## Antislop delivery gate

All statements below apply to the changed widgets and their layout.

- R-01 PASS: no decorative gradients or glows added; the existing loading bars identify pending reads.
- R-02 PASS: no em dash added to widget copy.
- R-03 PASS: browser checks cover overflow at five widths and two text sizes.
- R-04 PASS: no icon or emoji added to either widget.
- R-05 PASS: stacked editorial lists reuse the feed's content-led composition.
- R-06 PASS: existing Newsreader titles and sans labels retain their documented roles.
- R-07 PASS: no decorative background pattern added.
- R-08 PASS: no decorative arrow added.
- R-09 PASS: no pill badge or eyebrow added.
- R-10 PASS: no glass effects added.
- R-11 PASS: no new rounded controls added.
- R-12 PASS: no shadows added.
- R-13 PASS: no glow or status dot added.
- R-14 PASS: ranked links use the existing list treatment because each has equal discovery importance.
- R-15 PASS: article headlines are the link text; no generic CTA added.
- R-16 PASS: widget labels describe their actual rankings without marketing language.
- R-17 PASS: no user counts or unsourced statistics displayed.
- R-18 PASS: no testimonials added.
- R-19 PASS: no animation added; reduced-motion browser checks use the existing static layout.
- R-20 PASS: the established h/ wordmark, copper focus and serif editorial titles remain the site's identity.
- R-21 PASS: the documented fixed light appearance remains white in browser checks.
- R-22 PASS: no illustration added to the application.
- R-23 PASS: canonical links and stored titles come from existing story data; screenshots are labelled fixtures.
- R-24 PASS: canonical article links navigate successfully in browser tests.
- R-25 PASS: axe WCAG AA checks report no violations at the tested widths and text scales.
- R-26 PASS: there are no new buttons; visible article links navigate and retain tracking.
- R-27 PASS: each widget has its own loading, empty and unavailable copy, exercised in tests.
- R-28 PASS: no FAQ added.
- R-29 PASS: no colors added; all widget styles use existing semantic tokens.
- R-30 PASS: the change extends Hacksnap's existing editorial styling.
- R-31 PASS: the design choices and their reasons are recorded above.
- R-32 PASS: links accept focus and keyboard activation; hidden phone widgets leave the accessibility tree.
- R-33 PASS: application source and CSS are edited directly; screenshots use the existing browser harness.
- R-34 PASS: the documented single light appearance remains unchanged and is checked in browsers.
- R-35 PASS: production builds and widget/navigation browser checks run against the final implementation.
- R-36 PASS: no security, customer or performance claims added to product copy.
- R-37 PASS: the established site direction, Design Read and three dials are stated above.
- R-38 PASS: product content uses database stories; screenshot fixtures are explicitly identified.
- Liveliness PASS: existing story hierarchy, whitespace, copper focus and h/ editorial identity remain intact at 1/1/1.
- C-1 PASS: each major design choice has a written reason above.
- C-2 PASS: both widgets expose working canonical article links, including before hydration.
- C-3 PASS: both lists serve article discovery; no filler section added.
- C-4 PASS: tested responsive hiding, text enlargement, keyboard access, loading and outage states.
- C-5 PASS: rankings use recorded views; no fabricated production content or counts displayed.

# Story image browser checks

Captured on 2026-09-29 using the actual story card, story content and image
components in a temporary local fixture route. The fixture used local branded
artwork so these checks did not depend on a live Blob store or database. The
fixture route and development-only URL allowance were removed before commit.

- [Desktop, light](desktop-light.png): card and hero loaded at 1440px.
- [Desktop, dark](desktop-dark.png): card and hero loaded at 1440px.
- [Mobile, light](mobile-light.png): card and hero loaded at 320px.
- [Mobile, dark, 200% text](mobile-dark-200.png): card and hero loaded at 320px.
- [Mobile error, dark, 200% text](mobile-error-dark-200.png): forced card failure
  displays the branded placeholder while the hero remains loaded.

Measured document width matched the viewport: 1440px on desktop and 320px on
mobile, including enlarged text. Both loaded images reported a natural width of
1200px. After the forced error, the card contained one placeholder and no image
element; its media space remained reserved. Canonical Blob-only URL acceptance,
pending/failed/missing states, pre-hydration failures and social metadata are
covered separately by automated tests.

These are component fixture checks. Live Blob delivery and production social
crawler behavior remain part of the rollout canary.

## Generated artwork

The Python renderer was also checked with [a long Unicode headline](generated-unicode.png)
and [missing category/domain fields](generated-missing-fields.png). Both outputs
are 1200 × 630; headline text fits above the footer. These PNG previews were made
for inspection; the ingestion processor encodes uploads as WebP.

## Reconciliation with main

The unified `ArticleImage` component was rechecked after the main-branch update
on 2026-09-29 in a temporary local fixture using the production card/hero CSS.
The fixture used local generated artwork and was removed after verification.

[Measurements](main-sync/results.json) cover loaded images and a forced card
load failure at 1440px and 320px, light at normal text size and dark at 200% text.
The latest mobile category-above-image layout from main is included; the category
ends above the image at 320px in both text sizes. Document width equalled the
viewport in all cases. Card and hero dimensions
were unchanged after failure: desktop card 192 × 144, mobile card 224 × 168.

- [Desktop loaded](main-sync/1440-light-1x-loaded.png)
- [Desktop fallback](main-sync/1440-light-1x-failed.png)
- [Mobile loaded](main-sync/320-light-1x-loaded.png)
- [Mobile fallback, enlarged text](main-sync/320-dark-2x-failed.png)

These checks validate the shared component and layout styles. Canonical Blob URL
validation, old proportional assets and public API compatibility are covered by
automated tests; live production Blob delivery remains a canary check.

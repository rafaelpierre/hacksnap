# Frontend revamp verification

Implemented from [the approved plan](../implementation-plan.md) on refreshed
main `b224cbb`, using the current DEV mock, exact #0000FF accent and full-width
inset article images. Three implementation agents owned shell/navigation,
feed/data presentation and reader/sharing; the primary agent owned global CSS
and integration. A separate UX/accessibility review checked the result.

## Result and deliberate choices

- White cards on #F4F4F5; Bricolage headlines, Source Sans interface/copy,
  Newsreader long-form reading; ENERGY 2 / RHYTHM 2 / MOTION 1.
- Normal-flow header, native mobile disclosure, sticky desktop navigation and
  supporting rail. Container breakpoints respond to enlarged root text.
- Lead identity survives pagination and restoration. One optional detail read
  provides up to 220 characters from available current discussion topics, with
  a 500ms presentation deadline. No legacy substitution or full discussion in
  public card payloads or browser snapshots.
- Images retain intrinsic proportions, priority goes to the first eligible
  initial image, later images are lazy. Missing images leave no gap; decoding
  failure preserves reserved geometry. Virtualized measurements invalidate when
  feed width changes.
- Most read uses lifetime ranking on Latest, topic and dated feeds, below the
  feed at smaller widths. The weekly widget is removed from this presentation.
- Native modal sharing retains lazy editor loading, edited drafts, clipboard
  feedback/manual copy, keyboard containment and focus return.
- No schema, ingestion, public API, Markdown or RSS contract changes.

## Verification

Node 22.23.3, clean npm installation:

| Check | Result |
| --- | --- |
| `npm ci` | Pass; lockfile unchanged |
| `npm run lint` | Pass |
| `npm run format:check` | Pass |
| `npm run typecheck` | Pass |
| `npm run test:ci` | 74 suites, 398 tests pass |
| `npm run build` | Credential-free production build passes |
| `npm run browser:build` | Isolated production fixture build passes |
| `npm run test:browser` | 80/81 passed in final full run; final visual correction verified by all 6 visual cases, covering the remaining case |
| `git diff --check` | Pass |

The 81 browser cases comprise Chromium journeys, image geometry, accessibility,
sharing, performance and no-JavaScript checks, plus six iPhone WebKit history
cases. Long/slow story navigation, Back/Forward, explicit return, reload, loaded
depth and focus restoration pass. The final visual correction waits for layout
after changing text size, and protects the 200% wordmark from splitting.

Image evidence covers 320, 375, 414, 768, 959, 961, 1024, 1247, 1249 and 1440px,
including both sides of 60rem and 78rem transitions. Tests inspect selected
image candidates at desktop and DPR 2 mobile, portrait and diagram proportions,
missing media and delayed decode failure. Images in these tests are labeled
synthetic geometry fixtures, not publisher photography.

At 320px and 1280px, every main route is checked at 100% and 200% text. Axe
WCAG A/AA checks, browser accessibility-tree headings/landmarks, native keyboard
interactions, modal focus containment, no-JavaScript disclosures and storage
fallbacks pass. This does not substitute for a hands-on VoiceOver/NVDA session
or a physical-device keyboard test.

The macOS sandbox test commands used
`SWC_NATIVE_BINDING_CACHE=/private/tmp/hacksnap-swc-native` to keep the compiler
cache in an allowed directory. No runtime configuration changes are required.

## Screenshots and performance

- [Desktop feed](screenshots/feed-1440.png)
- [320px feed](screenshots/feed-320.png)
- [200% desktop text](screenshots/feed-1280-200.png)
- [200% phone reader](screenshots/reader-320-200.png)
- [Portrait artwork](screenshots/portrait-320.png)
- [Diagram](screenshots/diagram-414.png)
- [Missing image](screenshots/missing-414.png)
- [Failed image](screenshots/failed-414.png)
- [Modal sharing](screenshots/share-320-200.png)
- [Current blue mock, desktop](reference-blue-1440.png)
- [Current blue mock, phone](reference-blue-320.png)

The mock references keep its prototype toolbar and sample content. They were
rendered from unchanged `dev.html` with runtime blue palette overrides; the
production screenshots demonstrate the separately approved image addition.

[Recorded performance](performance.json) uses the unchanged synthetic fixture
and local desktop Chromium, not field measurements. LCP, CLS, JavaScript and CSS
budgets pass. Enlarged feed images transfer 2,192 bytes in the fixture versus the
old thumbnail cap of 1,500 bytes. After the [encoding experiment](image-format-comparison.md),
the user explicitly approved a 3,500-byte feed cap, equal to the existing reader
cap. All other budgets and WebP quality 75 remain unchanged.

## Delivery gate

- Hard gate PASS: exact palette/contrast unit checks, zero horizontal overflow
  in tested routes/sizes, real production data/links, loading/empty/error states,
  native keyboard controls, successful builds and recorded browser journeys.
- Purpose gate PASS: Bricolage supplies headline hierarchy, white cards separate
  reading units, blue marks actions/selection, existing topic icons identify
  taxonomy, proportional images provide article context. Only modal/popover
  surfaces use elevation; no marketing decorations or invented claims added.
- Liveliness PASS: approved 2/2/1 direction, lead headline focal point, structural
  spacing, one blue accent and existing Hacksnap wordmark/type identity are visible
  in the captured reference and implementation screens.
- Craftsmanship PASS: shared styles replace old copper/thumbnail/serif-feed
  presentation; controls retain behavior, content remains authentic, focused
  regression tests preserve navigation and payload contracts, and narrow text
  layouts were reviewed and corrected.

## Release and rollback

This branch is reviewable as one release PR. It has not been merged or deployed.
Feature branches do not receive automatic Vercel deployments under current
configuration. After release authorization, record the currently working Vercel
deployment and main commit, merge, then verify live feed/reader/topic/About
routes, real publisher images, sharing, mobile history and analytics.

Rollback is a focused revert of the release commits through the same checks and
deployment path. No database rollback or ingestion change is needed. Real
publisher-image quality and field LCP/CLS remain post-deployment checks.

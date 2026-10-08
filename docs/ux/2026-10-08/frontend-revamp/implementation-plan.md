# DEV frontend production implementation plan

Replace the production frontend presentation with the current [DEV mock](dev.html), incorporating two user-directed changes: use **#0000FF** as the accent and add **large article images spanning the padded inner width of feed cards**. The mock governs the layout, typography, spacing, navigation, reading surfaces and interaction presentation. Existing application code supplies the data, URLs and working behavior underneath that presentation.

Prepared 8 October 2026 against repository revision `f70ee69`. This deliverable is an implementation plan; production implementation and deployment follow separately.

## Visual specification

The current `dev.html` is authoritative. Its saved screenshots predate removal of the header tagline and rail footer note, as recorded in [delivery-gate.json](delivery-gate.json). Generate fresh implementation references from the current HTML, with the blue accent and image treatment described below. Sample stories, preview controls and comparison links belong only to the prototype.

| Element | Production target |
| --- | --- |
| Color | Exact `#0000FF` primary accent; `#F4F4F5` canvas; white header and reading cards; mock neutral text and borders. Replace purple and copper treatments throughout the visible interface. |
| Type | Local Bricolage for the wordmark and headings; Source Sans 3 for navigation, metadata and card copy; Newsreader for long-form reader copy, following the mock. |
| Wide layout | At the mock's 78rem breakpoint, an 83.5rem shell with 12.5rem navigation, flexible main content capped at 46rem, an 18rem rail and 24px column gaps. |
| Intermediate layout | At 60rem, left navigation and main content; supporting rail below the main content. Retain the mock's 42rem spacing adjustments. |
| Mobile | White header with wordmark and “Topics & menu”; inline expanding navigation; one main column; Most read below the feed. |
| Cards | Separate white bordered cards, modest corner radius, 16px gaps, mock headline hierarchy and spacing. The first logical story receives the lead treatment. |
| Images | Full card-content width, inset by the same horizontal padding as the headline and copy. Recommended position: immediately after the headline and before the takeaway. |
| Navigation | Latest, About and six labeled topic destinations in the mock's arrangement. Preserve the mock's normal-flow header and sticky desktop sidebars. |
| Reading and sharing | White reader panel, section navigation, expandable themes, related stories and the mock's modal share presentation. |

The visual direction is ENERGY 2 / RHYTHM 2 / MOTION 1, matching the mock. The lead headline establishes hierarchy; white cards separate reading units; blue identifies actions and selection; images provide article context. Motion remains limited to useful interaction feedback and respects reduced-motion preferences.

There is no visible feed hero, month picker, header tagline, “The takeaway” label or snapshot timestamp. Keep the accessible feed heading. Every topic card uses the mock's category-and-age metadata treatment, including within a selected topic feed. Legacy thumbnail columns, serif feed headlines, copper accents, old navigation chrome and old share-panel styling are replaced.

## Full-width card images

Use this reading order for cards with an available image:

1. Topic and compact age.
2. Headline.
3. Full-width inset article image.
4. Takeaway.
5. “Inside the discussion” preview on the lead card when usable analysis exists.
6. HN points and comment count.
7. Read brief, Discussion analysis and Share actions.

Placing the image beneath the headline gives readers context before the visual and keeps the headline as the card's primary entry point. This placement is the implementation recommendation because the user left its position open. The image width and surrounding padding are requirements.

- Apply the same full-width media treatment to lead and ordinary cards. Use the mock's existing card padding; do not restore a side-by-side thumbnail layout or make images bleed to the outer border.
- Start with intrinsic proportions: `width: 100%`, `height: auto`, and the source width/height to reserve space. Show screenshots, diagrams and portrait artwork without cropping meaningful content. Verify unusually tall media with real fixtures.
- Reuse validated canonical article images and the existing `ArticleImage` loading machinery. Keep source provenance and URL validation in the existing image pipeline.
- Replace `FEED_IMAGE_SIZES` in `story-row.tsx`, which currently describes a small desktop thumbnail, with sizes that reflect the new card width at each breakpoint. Check actual selected image candidates on desktop and high-density mobile screens.
- Prioritize only the first eligible visible image; lazy-load later images. Keep image dimensions stable before loading and while restoring a feed.
- A story without an available image has no media container or placeholder gap. A failed image request receives a restrained fallback within the reserved media area so failure does not move the reader's position; replace the old fallback styling with the new visual system.
- Use useful alternative text when supplied by the content source. Do not invent an image description from its headline alone.

The acceptance screenshots must include wide photography, a screenshot or diagram, portrait artwork, missing media and a failed request. Image requests, LCP and layout shift are release checks because this change deliberately increases rendered image size.

## Implementation stages

Develop in an isolated `codex/` branch and worktree based on refreshed main, following the repository workflow. Use one release PR with reviewable commits for the stages below so production receives a coherent visual replacement. Keep stylesheet ownership with one implementer when component work proceeds in parallel.

### 1. Establish the new presentation foundations

Primary files: `hacksnap/web/app/globals.css`, `app/layout.tsx`, `app/fonts`, `hacksnap/web/README.md` and `hacksnap/AGENTS.md`.

- Translate the mock's tokens, responsive geometry, type roles, spacing, radii and control sizes into the application's semantic CSS tokens.
- Set the base accent to `#0000FF`. Use white labels on filled blue actions, a coherent darker-blue hover/active treatment and a pale-blue selected background. Keep visible focus rings separated from filled controls.
- Blue and white have a computed contrast ratio of **8.59:1**. Verify all additional state pairings independently, including muted text, selected navigation and focus boundaries.
- Use the existing local font files to reproduce the mock's roles and weights. Update the prior white-page and Newsreader-headline documentation and assertions to describe this approved direction.
- Replace obsolete presentation rules within the affected components and stylesheet sections. Preserve framework setup and unrelated functional styles; avoid accumulating overrides that let old styling reappear on secondary routes.

Acceptance: the shared tokens and primitives reproduce the DEV direction with blue, including 44px controls and fixed light appearance under dark OS preferences or blocked storage.

### 2. Build the DEV shell and navigation

Primary files: `app/layout.tsx`, `app/main-navigation.tsx`, `app/topic-sidebar.tsx`, `app/sticky-header.tsx`, `app/categories.tsx`, `app/globals.css`, and route compositions.

- Implement the mock's header, left navigation, content columns and responsive rail placement. Remove the current header's persistent sticky presentation; reconcile scroll-offset helpers with the actual new header and sidebar behavior.
- Reuse the real category taxonomy and existing matching Lucide icons. Connect mock destinations to ordinary production URLs rather than copying the prototype's hash router.
- Implement “Topics & menu” as an inline disclosure that pushes content down, closes on selection and supports Escape with appropriate focus return. Keep `aria-expanded`, `aria-controls`, selected states and hidden-link focus behavior correct.
- Preserve one main landmark and working skip targets. Provide functional navigation without JavaScript using progressive enhancement or native disclosure behavior.
- Apply this shell consistently to the feed, story reader and About view. Give existing Topics, archive, API documentation, missing-page and error routes the same visual vocabulary. Existing public endpoints remain reachable without recreating old header or footer chrome.

Acceptance: navigation, header clearance and sidebar positions match the mock at narrow, intermediate and wide widths, including enlarged text. Browser Back and direct URLs select the correct destination.

### 3. Rebuild feed cards and Most read

Primary files: `app/story-row.tsx`, `app/article-image.tsx`, `app/windowed-story-list.tsx`, `app/story-feed.tsx`, `app/archive-story-list.tsx`, `app/popular-stories.tsx`, `app/[[...path]]/page.tsx`, and relevant presentation helpers.

- Compose cards in the order specified above, with full-width images and the mock's typography, spacing, metadata and action row.
- Pass an explicit lead-story identity/presentation through the feed. Determine it from the logical listing, not CSS `:first-child` or the first currently mounted virtual row. Appending another page must not create another lead card.
- Reuse `BrowseStoryLink` for titles and actions. Its existing `anchor="discussion-analysis"` support supplies the discussion destination while retaining feed context and analytics.
- Add a bounded, genuine lead discussion preview. Current public feed projections omit discussion bodies, so this requires deliberate data wiring. Fetch at most the initial lead's detail through the existing server read and pass a small presentation value tied to that story ID; never fetch full discussion detail for every card.
- Build the preview from the current analysis's available topic summaries using existing `storyDiscussion` availability semantics. Current analysis has no general overview field: do not substitute an older `discussion_summary` when current analysis exists, or invent consensus from selected comments. If no usable current text exists, omit the preview box. Define and test any legacy fallback separately.
- Keep full analysis out of public card payloads and browser snapshots. A restored listing may show the preview only when its stored lead identity matches the supplied preview; absence must not disturb restored depth or scroll. Optional preview-read failures must leave the feed usable.
- Recalculate virtualization height estimates and measurements for the larger cards and images. Preserve stable keys, loading depth and focused-story restoration.
- Render Most read with the mock's card, heading and row styling using real lifetime ranking. If topic labels require a small projection addition, obtain them from existing story categories. Keep its independent loading, empty and error states.
- Place Most read below the main feed at narrower widths, matching the mock. Verify that continuation, retries and end-of-feed controls remain reachable and that appended cards do not unexpectedly move focus.

Acceptance: Latest, topic and dated feeds use the new cards, genuine images and actual metrics. Ordering remains chronological with existing pagination. Lead styling stays attached to the correct story across append, virtualization and restoration.

### 4. Rebuild reading, sharing and supporting states

Primary files: `app/story/[id]/story-content.tsx`, `app/discussion-analysis.tsx`, `app/discussion-analysis.module.css`, `app/share-links.tsx`, its editor components, and supporting route/state components.

- Reproduce the mock's reader panel, Bricolage headline, Source Sans introduction, Newsreader reading copy, section links, theme disclosures, skepticism treatment and related-story list.
- Keep authentic article/discussion content, source evidence and availability states, presented with the new components. Use actual section targets and keyboard focus behavior for direct discussion navigation.
- Present the existing sharing functionality inside the mock's labeled modal dialog. Carry over canonical URLs, editable drafts, lazy loading, copy feedback and failure/manual-copy behavior. Implement focus containment, Escape, focus return and mobile keyboard access.
- Restyle source popovers and any additional production-only states with the same surfaces, type, blue actions and spacing. No legacy component should retain its old visual treatment because it was absent from the happy-path mock.
- Match loading, empty, error/retry and exhausted-feed states to the DEV system, driven by real request state. Incremental failures retain the already loaded stories.

Acceptance: a reader can open a brief or discussion, inspect evidence, share, read a related story and return to the exact feed position using the new interface throughout.

### 5. Verify fidelity and release

Update existing tests to encode the approved changes rather than preserving obsolete appearance assertions. Keep behavioral regressions covered by the current test infrastructure.

| Coverage | Existing files to extend |
| --- | --- |
| Exact blue, contrast, fixed light and new canvas | `tests/theme.test.mjs`, `e2e/visual.spec.ts` |
| Card order, lead identity and discussion preview availability | `tests/story-content.test.tsx`, presentation/feed tests |
| Large image sizing, priority, failure and proportional rendering | `tests/story-image.test.tsx`, `tests/article-image.test.tsx`, `e2e/visual.spec.ts`, `e2e/performance.spec.ts` |
| Mobile navigation, canonical URLs, no-JS and pagination | `e2e/journeys.spec.ts`, route and category tests |
| Loaded depth, scroll/focus restoration and iPhone history | `tests/story-navigation.test.tsx`, `tests/home-feed-navigation.test.tsx`, `tests/feed-snapshot-storage.test.tsx`, `e2e/story-browser-history.spec.ts` |
| New Most read placement and optional-data failures | `e2e/popular-stories.spec.ts` |
| Modal sharing, draft preservation and clipboard failure | Existing `tests/share-*.test.mjs`, `e2e/journeys.spec.ts` |
| Discussion evidence and keyboard source controls | `e2e/discussion-analysis.spec.ts` |
| Existing event identities and one event per interaction | Analytics unit/DOM tests and journey tests |

Capture fresh screenshots at 320, 375, 414, 768, 1024 and 1440px, plus immediately around the 60rem and 78rem layout transitions. Review 200% text, long titles, every image fixture, open navigation/dialogs and request-driven states. Compare against the current mock plus the two approved adjustments. Review each route for residual legacy styling.

Run keyboard and screen-reader checks for landmarks, heading order, menu disclosure, dialog focus, source evidence, announcements and return navigation. Automated accessibility checks supplement this review. Preserve SSR, no-JS links, canonical story URLs, metadata, Markdown/RSS/API behavior, route validation and storage fallbacks.

From `hacksnap/web`, using Node 22, run:

```sh
npm ci
npm run lint
npm run format:check
npm run test:ci
npm run typecheck
npm run build
npm run test:browser:ci
```

Run the configured Chromium and iPhone WebKit CI jobs. The browser fixture app is credential-free and must remain isolated from deployable production output. The ordinary build must continue to succeed without database credentials. Keep the existing LCP, CLS and asset budgets as release gates; optimize the larger images before proposing any budget changes.

Review a local production build or an explicitly configured nonproduction preview. Feature branches currently do not receive automatic Vercel deployments: [vercel.json](../../../../hacksnap/web/vercel.json) enables Git deployments only for `main`.

After release authorization, merge and verify the production deployment, key routes, images, sharing, mobile history and analytics. Record the previous working deployment and commit. A focused revert of this frontend release through the same validation/deployment path provides rollback. This work requires no schema migration or ingestion rollout.

## Completion criteria

- The visible frontend follows the current DEV mock, with exact blue accent and padded full-width feed images.
- Navigation, cards, reader, dialogs, supporting routes and failure states share that presentation; old visual treatments do not remain.
- The image placement and size are demonstrated on real image-bearing content, with missing/failing media handled explicitly.
- Fresh responsive screenshots, accessibility review and required application checks pass.
- The existing public content and navigation contracts continue to work, including no-JS reading and restored feeds.
- Documentation describes the shipped design and the PR records verification evidence and the release/rollback procedure.

Plan review: the design direction and image adjustment are recorded, source/component ownership is mapped, and implementation acceptance checks are defined. The stored mock verification is reference evidence only; production verification is required during implementation.

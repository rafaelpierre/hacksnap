# Hacksnap UX makeover references

Design snapshot: 26 September 2026. Audience: people following AI and engineering, especially engineers, technical leads, researchers and builders. The current content focus is AI news for people who build.

Production implementation is tracked in [issue #7](https://github.com/rafaelpierre/hacksnap/issues/7).

## Files and preview

- [Standalone interactive preview](hacksnap-prototype-preview.html): download and open in a modern browser, or serve this directory locally.
- [Editable HTML fragment](hacksnap-prototype.html): the source used to generate the preview.
- [Original UX review](../../ux-frontend-review-2026-09-26.md): observations and implementation suggestions. The decisions below take precedence where they differ.

To serve the preview from the repository root:

```sh
python3 -m http.server 8766 --bind 127.0.0.1 --directory docs/ux/2026-09-26
```

Open http://127.0.0.1:8766/hacksnap-prototype-preview.html. GitHub displays HTML source rather than running the preview.

The mockup includes Top stories, Latest, Topics, topic-filtered feeds, story pages and sharing. It uses six fixed stories and shortened copy. Ranking, dates, reading times and recommendations are illustrative. There is no live data integration. The standalone file includes its runtime; the fragment expects the visualization host's icon and control helpers. The preview may use CDN assets, so it is not guaranteed to work fully offline.

## Final design decisions

### Look and feel

- Keep the charcoal and warm off-white palette, copper accent and restrained green details.
- Preserve the typography on `main` (commit `eba6efb`): **Bricolage Grotesque** at weight 600 with automatic optical sizing for headings and the wordmark; **Source Sans 3** for body text, navigation and labels; the existing system monospace stack for code, ranks, points and timestamps. Keep Arial/sans-serif fallbacks and `font-display: swap`.
- Use readable body text, stronger headline hierarchy, consistent spacing and compact metadata.
- The HTML embeds the exact variable WOFF2 files from `hacksnap/web/app/fonts`, with their SIL Open Font License notices, so the typography works without external font requests.
- Add small, muted icons for points and comments while retaining readable labels.
- Make skepticism a clear High/Low pill with a subtle color and discussion icon. Preserve the classification's actual meaning.
- Support light, dark and system appearance, plus layouts down to 320px.
- Use plain copy. Avoid slogans such as “Independent. Curious. A little skeptical.”

### Discovery and story cards

- Make Top stories, Latest and Topics visible destinations.
- Remove the collapsible Topics control from the homepage. Keep a topic directory and a desktop topic sidebar.
- Use consistent story rows across feeds: source, clickable headline, short takeaway, topic, points/comments and one Share action.
- Remove the redundant “Read brief” link; the headline opens the story.
- Keep the lead story treatment restrained and avoid crowding cards with metrics or social buttons.

### Story page

- Keep a contextual return link and a compact Share action above the title area.
- Link the source domain in the byline to the original article.
- Use the headings **TLDR;**, **Discussion** and **Read next**.
- Remove duplicate “Read Original,” “Jump to Discussion” and “View the published Hacksnap story” actions.
- Remove the introductory “AI-generated article & discussion brief / comments sampled” strip.
- Keep the gap from the subtitle/deck to TLDR; compact (24px in the prototype).
- Retain relevant source-comment links within the discussion; remove the extra “All N HN comments” link.
- End with sharing, two next reads and a topic continuation. Omit the old recommendation subtitle.
- Remove “Sources, coverage & ranking details” entirely. General source, coverage and ranking explanations belong on a separate About page.

### Navigation and sharing

- Return to the originating list with its topic, sort and position preserved; provide a home fallback for direct arrivals.
- Provide Copy link separately from an editable suggested post and network destinations.
- Report successful copying only when it succeeds; offer manual copying otherwise.
- Keep navigation, menus and share controls usable with keyboard and touch.

## Implementation and validation

Apply the design through shared production components. Keep server-rendered story content and existing canonical URLs, social previews and source attribution. Handle pending summaries, missing sources, long headlines, empty lists, errors and loading states.

Check the complete browse → read → next story → share → return journey on desktop and phone, both themes, keyboard navigation, text zoom and narrow layouts. Validate contrast and focus behavior. Track second-story visits, recommendation clicks, sharing/copy outcomes and returning readers; set targets after measuring a baseline.

Search, saved/read states, subscriptions and richer story relationships remain possible follow-up work. The HTML files record a design direction; production integration and an About page are separate work.

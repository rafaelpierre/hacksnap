# Structured summary rendering

Synthetic browser fixture at `/story/91000039`; these screenshots demonstrate
formatting and contain no live generated article. Existing Bricolage Grotesque and
Source Sans 3 typography, colors, spacing and sentence layout are retained.

- [Desktop, 1280px](desktop.png)
- [Mobile, 320px](mobile.png)
- [Mobile, 320px with 200% text](mobile-200.png)

The opening remains linked to the source. H2 separates a main section, H3 identifies
a subsection, and short bold phrases make the evidence easier to scan. Short sources
can stay as one paragraph; the prompts preserve the 160-240-word target for
substantial sources added in PR #307.

Validation:

- PASS, hierarchy and emphasis: semantic H2/H3/strong elements render on the server;
  legacy text, selective bold and source-link boundaries have regression coverage.
- PASS, responsive reading: checked 320px and 1280px at 100% and 200% text with no
  horizontal overflow. The existing article suite also checks 375px and 768px.
- PASS, interaction and accessibility: source-link focus is visible; Enter opens
  discussion details; the existing suite opens the source in a new tab without
  JavaScript, exercises sharing, recommendations and browser Back. All 14 browser
  checks passed with no browser-console/hydration failures or axe WCAG A/AA violations.
- PASS, content safety: generated HTML and links remain inert; Markdown exports
  escape unsupported syntax; RSS and structured data strip supported formatting.
- PASS, implementation checks: 474 frontend tests, frontend lint, formatting,
  TypeScript and production build; 608 worker tests (two optional database integration
  tests skipped) and Ruff. Prompt tests use mocked inference, not a live model run.

Malformed emphasis is consumed as a literal delimiter pair, so a closing marker
cannot open an unrelated later phrase. Regression coverage checks malformed,
whitespace-padded, triple, escaped and multiline markers followed by valid bold,
including adjacent phrases, across HTML, Markdown and plain-text exports.

Feed projections preserve up to two complete topic summaries within the schema's
600-character limit per topic. Cards and the public feed strip bold markers before
applying the 220-character excerpt limit. Regression coverage exercises the SQL
projection, API output and card rendering, including bold spans across the former
440-character SQL cutoff and oversized stored summaries.

The final browser run passed without server or browser-console errors.

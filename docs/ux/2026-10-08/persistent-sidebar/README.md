# Persistent site sidebar

Most read is rendered by the root layout on direct document requests and remains
mounted across client navigation. Feed and article routes no longer own it.
Article paragraphs and key points retain Source Sans 3, matching the byline.
The existing responsive behavior is retained: right column at 78rem, after the
main content below that width.

Validation: 401 tests in 74 Jest suites; 38 browser checks covering direct URLs,
reloads, canonical redirects, persisted sidebar DOM across Article/About/Article,
JavaScript-disabled populated/delayed/empty/failed popularity, handled data outages,
404s with JavaScript, keyboard navigation, browser history in Chromium and iPhone
WebKit, asset budgets, 320px/desktop widths, 200% text and axe accessibility checks.
Lint, formatting, TypeScript and the credential-free production build pass.

Supporting HTML pages now render per request so the shared popularity result is
not fixed at build time. Its existing five-minute data cache is retained.
Nonexistent story URLs preserve their 404 status. Next currently emits an empty
error document without JavaScript for these URLs; the shared shell appears after
client recovery. Valid article URLs and handled data outages work without JavaScript.

Screenshots use synthetic local fixtures. Desktop and mobile views were inspected;
no new styling or visual components were introduced. Design reuses Bricolage
headlines, Source Sans text, existing colors, spacing and responsive gutters.

| View | Normal text | 200% text |
| --- | --- | --- |
| Desktop article | [1440px](desktop.png) | [1440px](desktop-200.png) |
| Mobile article | [320px](mobile.png) | [320px](mobile-200.png) |

[About with shared sidebar](about.png)

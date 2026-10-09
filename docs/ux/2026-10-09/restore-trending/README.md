# Restore Trending

Browser-fixture screenshots show Trending above Most read using the shared card.
The article titles and images are deterministic test fixtures, not production data.

Verified at 320, 393, 768, 820 and 1440px with 100% and 200% text. Checks cover
separate seven-day and lifetime lists, card order, wrapping without horizontal
overflow, 44px link targets, keyboard focus and automated WCAG accessibility.
Both widgets remain usable without JavaScript. Weekly failure leaves Most read
available, and empty/failed reads preserve the main feed.

Validation: 412 unit tests and 31 browser tests pass, including Chromium and
iPhone WebKit navigation history checks. Lint, format, typecheck and production
build pass with Node 22.

# Issue 141: optional-section streaming check

Measured on 2026-09-29 with a temporary local Next.js route in a production build
(`next build` and `next start`), Node 22.23.3, and headless Chrome 154. The route was
removed before the final build. It used fixed story and two recommendation records,
no database or network data source, an optional recommendation delay of 1,200 ms,
and a 250 ms primary delay in the "cold" case. "Warm" used no primary delay. A
blocking comparison awaited the same optional delay before returning the article,
matching the previous page's sequencing. These are controlled fixture measurements,
not production traffic, database latency, or a claim about cache hit rates.

Chrome recorded the first appearance of the story headline and recommendation
list with a `MutationObserver`. It recorded layout-shift entries without recent
user input using `PerformanceObserver`. For layout shift, the recommendation
fallback was scrolled into view before the optional promise resolved; the 200%
text case set the document root font size to 200%. A comparison removed the
fallback's 15rem reservation before the optional result arrived. Each table cell
below is one local run, rounded to the nearest millisecond; timing varies by host.

| View | Primary delay | Headline | Recommendations | In-view layout shift |
| --- | ---: | ---: | ---: | ---: |
| 320px | 250ms | 323ms | 1,487ms | 0.018 |
| 320px | 0ms | 15ms | 1,207ms | 0.018 |
| 320px, 200% text | 250ms | 265ms | 1,462ms | 0.055 |
| 320px, 200% text | 0ms | 13ms | 1,216ms | 0.055 |
| 1280px | 250ms | 265ms | 1,462ms | 0 |
| 1280px | 0ms | 14ms | 1,217ms | 0 |

At 1280px, the blocking comparison showed the headline at 1,471ms with the
250ms primary delay and 1,233ms without it. Without fallback space, the in-view
shift was 0.052 at 320px and 0.281 with 200% text. The reserved space reduced
those shifts to 0.018 and 0.055. It does not eliminate movement for long titles;
empty or failed recommendation reads can contract the reserved area. The article
and its source link are present in the initial stream even if the optional result
never arrives or browser JavaScript is disabled.

The checked-in `optional-streaming.test.mjs` uses deferred promises to verify
that the headline/brief and category list reach the initial stream before optional
reads resolve, that required queries finish before optional ones start, and that
optional database errors do not become unhandled stream errors. It also covers
canonical redirects and missing stories. Existing analytics tests cover exposure
after recommendation cards become visible.

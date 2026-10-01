# Story projection byte sample

Run `node docs/evaluations/issue-144/measure.mjs` from the repository root. The script uses one shared discussion-analysis fixture, representative summary text and 24 rank captures. It measures UTF-8 bytes in `JSON.stringify` of the old and new logical result/cache rows; it does not claim production traffic or PostgreSQL wire-byte savings.

| Row | Before | After | Change |
| --- | ---: | ---: | ---: |
| Card | 6,738 B | 937 B | −86% |
| HTML article | 8,543 B | 5,796 B | −32% |

Card SQL now selects the takeaway, sentiment and coverage, plus the latest two rank captures within the 24-hour window. Continuation cards anchor that window to the cursor timestamp. Article HTML/metadata SQL retains full content but reads neither rank history nor retained ranking metrics. Markdown loads metrics separately. RSS and the public list use explicit export projections, so their article and discussion strings remain available.

The common top-ten selection still expires after 60 seconds. API export rows and Markdown rank history use separate bounded 60-second caches keyed by the selection timestamp and IDs; concurrent requests share each fill. These reads can be refreshed separately from the selection. API export rejects a newly pending or removed selected row instead of returning it with a mismatched cached rank. Story metrics have a separate 30-minute cache and are never loaded for HTML or metadata.

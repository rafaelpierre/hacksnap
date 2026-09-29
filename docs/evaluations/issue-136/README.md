# Issue #136: related-story relevance evaluation

Evaluation recorded 2026-09-29. **Decision: defer a selector or UI change.** The
current policy and one public example show a plausible relevance problem, but this
is not a representative pair assessment and no continuation exposure or meaningful
reading results were available to this evaluation. Issue [#133] remains open; that
status alone does not establish whether a release or telemetry exists elsewhere.
This follow-up is separate from the [#130 MVP] and must not alter its selection
policy before the continuation checkpoint.

## Observed baseline

The checked-out code's [selector] takes the source category and HN ID, joins the
same-category stories to summaries, sorts by `date_added DESC, hn_id DESC`, and
returns three rows. [Story data] passes these to [Read next], which filters the
source ID again and displays the first two. The query does not test whether
`overall_takeaway` is nonblank, and the UI does not reject a different HN ID that
covers the same event. No title, brief, entity, or discussion-theme similarity
affects ordering. This is a code baseline, not an observed engagement baseline.

The public [source page] fetched at 2026-09-29 17:45 UTC rendered the following
same-category recommendations. This is **one convenience sample**, selected from
the homepage, and is not representative of the six categories or the stories that
readers actually encounter. The manual labels assess topical connection from the
displayed titles and source brief; they do not assert article or discussion quality.

| Source (Industry & Society) | Read next target | Manual connection | Reason |
| --- | --- | --- | --- |
| [Owed a billion dollars in Nvidia stock] | [It's Time to Investigate the AI Labs] | 0/2, unrelated | A stock-option limitation dispute and congressional scrutiny of AI labs share only the broad category. |
| Same source | [Pacing the Frontier is not the actual goal for AI labs] | 0/2, unrelated | The stock-option dispute and AI-lab goals address different subjects. |

Rubric: **2** = same concrete entity/problem with a useful new angle; **1** =
plausible adjacent topic; **0** = category-only or no useful connection. Mark
duplicate/repeated coverage separately, even if it would otherwise score 2.
This example motivates a broader assessment; two weak pairs from one source cannot
estimate a site-wide weak-match rate or establish that a candidate policy improves
it. Repeated attempts to fetch more public pages encountered DNS resolution errors,
so no wider live sample is claimed.

The checkout has recommendation-card exposure/click events, documented in the
[analytics contract], but no article-continuation implementation or event contract
for visible continuation exposure and meaningful reading. I did not query GA or a
production database. Therefore exposure rate, meaningful-reading rate, coverage,
and differences by position/device/category are **unknown** here. Low exposure,
if later observed, must be separated from poor relevance: placement, loading,
reader intent, and page depth can also explain it.

## Evaluation required to reopen

1. After #133's release, record its deployed version, observation window, event
   definitions, and settled export range. Count loaded, actually visible, and
   meaningfully read continuation articles separately. A prefetched or mounted
   article cannot count as exposed. Define meaningful reading before inspecting
   results (for example, active dwell plus progress through the continuation body),
   and report missing observer/analytics coverage and sample size by position,
   device, and category. Compare exposed-to-meaningfully-read rates, not automatic
   page views. Use a settled window with at least two full weeks of traffic; extend
   it when exposed counts are too small to judge a change.
2. Save a reproducible, timestamped snapshot of at least 30 source stories with
   usable briefs, stratified across all six categories, recent/archive age, and
   actual continuation exposure when available. For every source, capture the
   baseline's two displayed targets plus the bounded candidate pool, IDs, dates,
   titles, canonical URLs, category, and permitted brief/theme fields. Include
   sources with zero or one eligible result. Sample from distinct source IDs rather
   than repeated views of one popular article. Do not publish reader identifiers.
3. Have two reviewers independently label each baseline and proposed source-target
   pair using the rubric above, plus duplicate/repeated-coverage and unusable-brief
   flags. Resolve disagreements before scoring. Report per-category counts, 0/1/2
   distribution, duplicate rate, no-suggestion rate, and disagreements. Do not
   substitute synthetic fixtures for this production sample.
4. Compare a frozen baseline against a frozen, deterministic candidate on the
   **same sources and snapshot**. Report the paired change in strong matches (2),
   weak matches (0), duplicates, and zero-result sources, with raw counts and
   uncertainty intervals. Reopen implementation only if #133 has measurable
   continuation exposure, the labeled baseline reveals a material relevance
   defect, and the candidate clearly improves pair quality without unacceptable
   loss of useful suggestions. Set numeric success and coverage tolerances from
   the measured baseline before a reader-facing experiment. If engagement is low
   but pair labels are strong, investigate placement and loading first.

## Bounded candidate to test, not ship yet

Use one shared server-side selector for both standalone `Read next` cards and
article continuation. Pass the source story and a bounded same-category pool with
usable briefs; select the original continuation set once so appended articles do
not recurse. Limit retrieval to a fixed, recent candidate window (provisionally
100), then rank with explainable title/brief/theme terms after removing generic AI
and category words. Test entity and concrete-topic agreement separately from broad
word overlap. A sufficiently strong match may be older than the newest two.

Before ranking, reject the source HN ID, other IDs with the same normalized
canonical source URL, and clear repeated coverage identified by near-identical
titles/briefs. Treat URL normalization and near-duplicate thresholds as rules to
validate against the labeled sample, not as proof of semantic identity. Return
zero, one, or two results; never fill an empty slot with a weak category-only
match. Preserve a deterministic tie order (`date_added DESC`, then HN ID) and a
stable maximum of two. This design uses existing fields, a bounded read query,
and local scoring; it requires no external model call or new service cost. Measure
database rows/latency and scoring CPU against the current query before rollout.
The finite window can miss an older excellent match, and lexical overlap can miss
synonyms or overvalue repeated headlines; both limitations belong in the sample
review.

If the gate passes, implement and test one policy consumed by both surfaces.
Regression cases must cover source exclusion, canonical-URL and repeated-coverage
duplicates, blank/unusable briefs, weak/no matches, one result, stable ties, and
the bounded output/pool. Compare saved outputs against the frozen baseline before
changing either UI. Preserve article loading, exposure semantics, and the main
article's failure isolation from #133.

[#130 MVP]: https://github.com/rafaelpierre/hacksnap/issues/130
[#133]: https://github.com/rafaelpierre/hacksnap/issues/133
[selector]: ../../../hacksnap/web/lib/categories.ts
[Story data]: ../../../hacksnap/web/lib/data.ts
[Read next]: ../../../hacksnap/web/app/related-stories.tsx
[analytics contract]: ../../analytics/README.md
[source page]: https://hacksnap.live/story/49872723
[Owed a billion dollars in Nvidia stock]: https://hacksnap.live/story/49872723
[It's Time to Investigate the AI Labs]: https://hacksnap.live/story/49883471
[Pacing the Frontier is not the actual goal for AI labs]: https://hacksnap.live/story/49884119

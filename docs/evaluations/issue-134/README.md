# Latest ordering evaluation — issue #134

Issue: [#134](https://github.com/rafaelpierre/hacksnap/issues/134)
Parent MVP: [#130](https://github.com/rafaelpierre/hacksnap/issues/130)
Required browsing release: [#132](https://github.com/rafaelpierre/hacksnap/issues/132)

## Decision

**Defer the Latest-as-default behavior.** This evaluation has no verified release
report or production measurement showing that freshness or repeated exposure is the
main reader problem. Issue #132 is still open, and the evidence available here does
not verify its continuous-browsing release or the required measurement of actual
deeper-story opens, loading outcomes, exhaustion, and restored returns. That is not
proof that no release or measurement exists elsewhere.

This is not a claim that Top is better. It keeps the existing public behavior
while collecting the evidence needed to decide whether a chronological default
would help.

## Evidence ledger

| Source reviewed | Observed fact | What it cannot establish |
| --- | --- | --- |
| #134 | This follow-up is conditional on return behavior, repeated exposure, deeper opens, and reader feedback from #132. | It contains no measured results. |
| #130 and #132 | The MVP preserves ranking; #132 must measure actual deeper-story opens and loading/end outcomes after release. Both issues are open. | Issue state does not prove absence or presence of a deployed release, but the repository has no recorded release report. |
| [`docs/analytics/README.md`](../../analytics/README.md) | The current v2 contract records `reader_visit`, `story_view`, `return_visit`, and recommendation events. Its baseline register says deployment, GA/BigQuery access, first event verification, and all measured rates are pending. | It cannot attribute a story view to Top versus Latest, a feed position/batch, or a loaded-list snapshot. |
| [`hacksnap/README.md`](../../../hacksnap/README.md) | Top prefers stories first collected in the last 24 hours, then orders by HN points and ID. The website displays up to ten usable summaries from that ranked pool. | It does not measure reader demand for a different order. |
| [`data/src/hn_trending/storage.py`](../../../data/src/hn_trending/storage.py) | `date_added` is inserted when the collector first sees a story and is deliberately not overwritten by the thread upsert. | Collection time is not the time that a readable Hacksnap brief became available. |
| [`hacksnap/pipeline/supabase.py`](../../../hacksnap/pipeline/supabase.py) | A summary write sets `generated_at` and `updated_at`; subsequent summary/analysis work can update those values. | Neither field is an immutable first-public-availability timestamp. |
| [`hacksnap/web/lib/archive.ts`](../../../hacksnap/web/lib/archive.ts) | The current Archive, labelled “Latest stories,” orders all stored threads by `date_added DESC, hn_id DESC`. | It is an archive browse view, not a public-ready Latest feed: it can include unsummarized or ineligible rows. |

No production database or GA export was queried for this evaluation. There is no
recorded reader-feedback study. The absence of those inputs is a measurement gap,
not evidence of low demand.

## Current contracts and timestamp finding

The homepage's `getLeaderboard()` reads `hacksnap_ranked_stories`, filters to
nonblank `overall_takeaway` previews, and orders by its canonical rank. That rank
is shared with worker prioritization and ranking history. Its candidate rule uses
the original `date_added` to split the most recently collected 24 hours from the
archive fallback, then orders each group by current HN points and descending HN
ID. A later HN-score change can therefore reshuffle Top.

The archive independently orders `hacker_news_threads` by `date_added DESC, hn_id
DESC`, groups it by that collection date, and provides ordinary pagination. The
public JSON list and Markdown leaderboard derive from the Top selection. RSS
independently renders the latest 50 stored threads by `date_added DESC, hn_id DESC`;
it is neither the homepage Top selection nor a public-ready Latest feed. A default-
order experiment must retain all three existing contracts unless a compatible,
separately versioned change is deliberately introduced.

For a future public Latest feed, define **first ready at** as the immutable UTC
instant when a story first completes an atomic summary write with a nonblank
`overall_takeaway` and is eligible for public display. Store it in a dedicated
`first_ready_at` column (or an equivalently immutable append-only record). Do not
derive it from `date_published`, `date_added`, `generated_at`, `updated_at`, rank
history, or routine refresh time. A later summary refresh, sentiment refresh,
ranking movement, or image update must not change it.

The eventual Latest candidate set must use the same public-readiness and current
eligibility rules as the feed, rather than reusing the archive's all-thread query.
Order it by `first_ready_at DESC, hn_id DESC`. Keep Top's current rank order as a
visible choice. These semantics require a schema and data-access change; they are
specified here only and are not implemented by this evaluation.

## Proposed experiment

Run this only after the first #132 production release has a verified event stream.
First collect a **Top-only first-observed post-release baseline** for two complete
weeks, then allow seven full days of return follow-up and the documented export
lag. Use the existing UTC, contract-version, device, acquisition-source, and
missing-identity exclusions in `docs/analytics/README.md`.

After the baseline and sample-size calculation, run a reader-level randomized
default-order experiment for eligible homepage readers:

| Arm | Initial homepage order | Required experience |
| --- | --- | --- |
| Control | Current Top | Preserve current rank ordering and visible Top/Latest switcher. |
| Treatment | Experimental Latest | Show public-ready stories by immutable `first_ready_at`; retain the same switcher and Top view. The experiment flag must not make Latest the permanent default. |

Assign an opaque arm at a reader's first eligible homepage visit and persist it for
the measurement window with a consent-compatible first-party mechanism. All linked
visits use that arm. Readers without durable assignment or GA identity, including
blocked storage, consent-limited, cleared-cookie, and cross-device cases, cannot
support the repeated-exposure or return primary measures; report them separately as
unassigned visit-level traffic and do not silently pool them with reader-level
results. For each visit, freeze an opaque feed snapshot before the first batch. Its
order, cursor, loaded batches, chosen mode, and reading anchor must remain stable
until the reader explicitly asks for new stories. This is necessary for #132
pagination and restoration; a newly ready story must not push a card beneath a
reader during the same visit. Direct URLs, ordinary pagination without JavaScript,
Back/Forward, and the contextual return path must reconstruct that same state.

Add these allowlisted, content-free fields before the experiment. Send IDs and
small enums only; do not send titles, summaries, URLs, drafts, or raw feedback to
GA. Carry the originating homepage `visit_id` as `source_feed_visit_id` on
the destination story event: the story route has its own distinct `visit_id`.
Join that source visit to the exposure event, never the destination visit ID.
Also record the assigned experiment arm separately from selected `feed_mode` so
mode switching does not change intent-to-treat assignment. High-cardinality snapshot IDs belong in BigQuery event parameters, not GA UI
custom dimensions.

| Event or extension | Trigger | Required fields | Purpose |
| --- | --- | --- | --- |
| `feed_story_exposure` | At least 50% of a card is visible once per visit/snapshot/story. | `feed_mode`, `story_id`, `position`, `batch`, `snapshot_id` | Denominator for exposure and repeated-story measures. |
| `story_view` extension | A story page actually mounts after a feed navigation. | `entry_surface=feed`, `source_feed_visit_id`, `feed_mode`, `feed_position`, `feed_batch`, `snapshot_id` | Counts an actual opened brief; prefetches and loaded batches do not count. |
| `feed_batch_outcome` | A requested batch settles or the feed is exhausted. | `feed_mode`, `batch`, `outcome=loaded|failed|retry|exhausted|expired` | Separates viewing from loading and makes reliability measurable. |
| `feed_refresh` | Reader explicitly requests a newer snapshot. | `feed_mode`, `prior_snapshot_id` | Distinguishes a deliberate refresh from mid-read reshuffling. |

If reader feedback is collected, use a separate opt-in, privacy-reviewed feedback
mechanism with a question that distinguishes “I wanted newer stories” from “I kept
seeing the same stories.” Report coded themes and response count separately from
GA rates. Do not infer feedback from a switcher click.

## Metrics and decision rules

Pre-register the cohort, observation window, minimum detectable effect, and
practical non-inferiority margins *after* the baseline supplies its rates and
variance. A numerical target before then would invent a baseline. Report counts
by assigned arm, device, and acquisition source; retain unknown source and
missing-ID counts. Use 95% Wilson intervals for reader-level proportions. For
visit/opportunity rates and arm differences, use reader-clustered uncertainty
estimates so repeated visits are not treated as independent randomized units.

| Measure | Definition | Desired result |
| --- | --- | --- |
| Repeated-story exposure | Returning identifiable homepage readers exposed to the same `story_id` on two or more distinct homepage visits / returning identifiable homepage readers with a feed exposure. | Lower in Latest, with a confidence interval excluding the pre-registered practically unimportant range. |
| Feed-to-story open rate | Unique matched opportunities: one `(visit_id, snapshot_id, story_id)` with `feed_story_exposure` and its matching first `story_view` carrying that feed context / unique exposed opportunities. A link activation must establish its exposure opportunity before navigation; unmatched story views are retained as an unattributed diagnostic and excluded from the rate. Report initial and later batches separately. | No material degradation; an improvement is evidence of better browsing. |
| Deeper-story opening | Eligible homepage visits with at least one unique matched feed-to-story opportunity from a batch after the initial batch / eligible homepage visits with a snapshot. Report the number of matched opportunities separately; do not use raw event counts as a rate. | Higher or non-inferior, depending on the pre-registered decision criterion. |
| Seven-day return | Existing documented different-session return rate. | No material degradation. |
| Reliability | Failed, expired, retry, and exhausted batch outcomes per request; restored-return failures from #132's navigation checks. | No material regression and no unrecoverable loop or content loss. |
| Reader feedback | Coded freshness/repetition themes and response count. | Interpreted as supporting context, never as a rate without a known sampling method. |

Begin a gated, flag-scoped **experimental implementation** only when all of these
are true:

1. #132 is released and its production event stream has been verified, including
   actual deeper-story opens rather than automatic loads.
2. The Top-only baseline, sample-size calculation, and a reviewed `first_ready_at`
   migration and legacy-data policy are complete.

Start reader assignment for that experiment only after the implementation's
immutable timestamp, public-ready candidate query, mode-aware exposure,
matched-open, batch-outcome, and refresh events have passed local and production
event verification. This keeps experimental delivery distinct from collecting the
experiment and from a permanent default change.

Adopt Latest as the permanent default only after the pre-registered sample-size
target and follow-up window are complete, the experiment clears the repeated-
exposure primary criterion without crossing a guardrail margin for opens, returns,
or reliability, and any feedback finding is reported with its collection method.
Otherwise preserve Top as the default. A mixed result can justify further
experimental measurement, but not silently replacing the rank-based homepage
contract.

## Conditional implementation checklist

### Experimental Latest implementation

After the experimental implementation gate is met, make one focused, flag-scoped
change set:

1. Add and populate immutable `first_ready_at` through the summary publication
   transaction. Define a conservative policy for legacy summaries and document the
   resulting availability boundary.
2. Implement a public-ready Latest query ordered by `(first_ready_at DESC, hn_id
   DESC)` with keyset/snapshot pagination and reader-level experiment assignment.
   Keep worker ranking, Top, rank history, JSON/Markdown, and RSS contracts
   unchanged unless their changes are separately versioned and tested.
3. Add the explicit mode switcher, mode-aware canonical navigation state, stable
   snapshots, explicit refresh, and return restoration. Do not use a refresh or
   summary update as a new publication.
4. Extend the analytics allowlist and analysis query with the fields above. Verify
   desktop/mobile DebugView or equivalent request captures before collecting the
   experiment.
5. Test timestamp ties, rows becoming ready during a visit, refresh behavior,
   duplicate triggers, pagination boundaries, JavaScript-disabled navigation,
   Back/Forward, contextual returns, and Top/Latest API/Markdown/RSS behavior.

### Permanent-default adoption

After the completed experiment clears its adoption rule, make a separate, small
default-selection change. Re-run the same navigation, accessibility, contract, and
analytics checks. Preserve the explicit Top switcher and retain the experiment
report with the release record. Do not combine this adoption change with the
timestamp migration or the experimental instrumentation.

The database portion must follow the repository's Supabase/Postgres guidance at
the time it is authored. The frontend portion must run the validation sequence in
`hacksnap/AGENTS.md`, including browser and accessibility checks for the changed
navigation and restoration behavior.

## Reopening criteria

Reopen the experimental implementation gate when a dated evaluation report contains
the #132 deployment identity, verified collection start, BigQuery export range/job
identity, event counts, exclusions, and the full two-week baseline plus mature
return follow-up. Attach the timestamp-migration design and the explicit legacy-
data policy before the experimental implementation. Start the experiment only after
the resulting feature's events are verified. Reopen permanent-default adoption only
with the completed pre-registered experiment analysis.

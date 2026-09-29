# Implementation plan: issues 134–136

Prepared 2026-09-29 from the issue descriptions and current repository code.

## Delivery gates

These are evidence-gated follow-ups to #130, not prerequisites for its MVP.
Issue #132 must supply homepage browsing evidence for #134 and #135. Issue
#133 must supply continuation exposure and meaningful-reading evidence for
#136. All three prerequisite issues were open when this plan was prepared;
issue state alone does not establish whether production evidence exists.

Prepare each evaluation independently now. Record observed facts, missing data,
an experiment, and a proceed/defer decision. Missing evidence means defer the
behavior change, with explicit reopening criteria; never invent a baseline.
Only implement production behavior when its issue's evidence gate is met.

## Assignments and scope

| Issue | Agent model | Reason | Owned scope |
| --- | --- | --- | --- |
| #134 Latest ordering | gpt-5.6-terra | Bounded product evaluation and publication-contract design | Latest evaluation document and proposed feed-order experiment |
| #135 Enrichment coverage | gpt-6-sol | Worker prioritization, retry behavior, cost and database dependencies | Coverage evaluation, bounded candidate/budget design and rollout plan |
| #136 Related relevance | gpt-6-sol | Representative relevance assessment, duplicate handling and shared selector design | Relevance evaluation, baseline assessment and conditional selector plan |

### #134: Latest ordering

1. Review #132 evidence for return visits, repeated exposure, deeper-story opens
   and reader feedback. Separate measured results from instrumentation gaps.
2. Inspect current archive, ranking, pagination and timestamp contracts. Define
   first availability of usable content without treating refreshes as publication.
3. Specify a freshness-first experiment, retaining Top, stable session ordering,
   explicit refresh and reading-position restoration. Define success metrics and
   safeguards before changing the default.
4. Record proceed/defer and dependencies. If proceeding later, verify ties,
   refreshes, pagination, restoration and API/Markdown/RSS compatibility.

### #135: Enrichment coverage

1. Establish available source volume, usable-summary inventory, daily new briefs,
   collection-to-ready delay, exhaustion demand and processing cost/latency.
2. Inspect top-ten candidate selection, caching, retries and failure handling.
   Distinguish source shortage from a coverage bottleneck.
3. Define the smallest justified expansion, with explicit per-run work/cost caps,
   priority preservation, deterministic selection and no repeated enrichment of
   already usable stories just to fill the feed.
4. Record proceed/defer; define quality, latency, rollback and rollout criteria.
   Conditional implementation needs budget/retry/failure regression tests and
   applicable worker/database checks. Production deployment is a separate action.

### #136: Related-story relevance

1. Review #133 exposure and meaningful reading separately; exposure without
   engagement alone does not establish a relevance defect.
2. Assess a representative set of current same-category pairs. Explicitly label
   synthetic fixtures; do not present them as production evidence.
3. Compare the baseline with the simplest explainable, bounded deterministic
   policy using existing titles, briefs, categories or themes. Exclude source
   stories, duplicates and repeated coverage; abstain on weak matches.
4. Record proceed/defer and limitations before UI changes. Any delivered selector
   must be shared by standalone recommendations and continuation, with tests for
   exclusion, duplicates, weak/no matches and stable bounded output.

## Isolation and validation

Each issue has its own managed worktree based on freshly fetched origin/main.
Agents must preserve unrelated work, read applicable AGENTS.md instructions and
skills, and keep changes within their assigned scope. RTK.md was referenced by
the user but was not present in this repository during initial inspection.

Documentation deliverables receive content/link review and git diff --check.
Implementation changes require the repository checks for their affected modules.
Frontend behavior requires lint, formatting, tests, typecheck and build, plus
the applicable browser/accessibility checks. Worker changes require pytest and
Ruff; database authoring requires the applicable database skills and validation.

Integrate behavior changes only after the corresponding MVP release evaluation.
Do not bundle these follow-ups into the MVP or merge/deploy as part of planning.

## Reviewed evaluation results

- [#134: Latest ordering](evaluations/issue-134/README.md) — defer a default change;
  define first-ready semantics and separate experiment delivery from default adoption.
- [#135: Enrichment coverage](evaluations/issue-135/README.md) — defer expansion;
  collect readiness snapshots with the [read-only baseline query](evaluations/issue-135/baseline.sql).
- [#136: Related relevance](evaluations/issue-136/README.md) — defer selector changes;
  gather a representative paired assessment and continuation metrics.

All three evaluations are local evidence reviews, not completed production
experiments. The linked issues remain open for the missing evidence and conditional
implementation. Summary upserts reset `generated_at`; it cannot establish historical
first publication. RSS retains its independent collection-date ordering.

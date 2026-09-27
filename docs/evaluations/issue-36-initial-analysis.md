# Initial discussion analysis: validation and rollout measurements

Issue: [#36](https://github.com/rafaelpierre/hacksnap/issues/36)

## Implementation

Prompt `v5-initial-discussion-analysis` adds the version 1 discussion contract to
the initial summary response. Claims come from the supplied article or HN text;
stance and topics use the full prepared comments with available ancestors.
Sentiment retains its separate ten-comment sample. Initial analysis, coverage,
source/input fingerprints, model and versions, and UTC analysis time use the
existing atomic summary write from #35. Validation precedes that write and cleanup.

Existing summaries keep their sentiment-only path, even after prompt/model
changes. This change does not backfill them or fetch historical sources. Analysis
refresh for stories that already have it remains a separate deliverable.

## Local checks

The shared synthetic semantic fixtures pass through mocked initial inference,
source validation, and persistence. They cover one-sided criticism, sparse support,
sarcasm, a reply to a critic, qualified agreement, neutral questions, ethical
concerns, multiple claims, no comments, unavailable sources, HN text, and open
questions. These checks preserve the expected outputs, including empty supportive
lists for neutral evidence; they do not measure a live model's semantic accuracy.

Failure tests reject missing analysis, unknown citations/claims, incompatible
stances, contradictory status, unavailable claim sources, extra fields, mutated
models, and incomplete responses even when their JSON is valid. Repository tests
verify the complete atomic write and protection against a concurrent legacy row.
Coverage tests distinguish truncated preparation from an actually empty thread.

## Response budget and measurements

The output cap remains **8,000 tokens**. Prompt guidance budgets at most 120 words
per summary, 40 per existing key point/discussion point, and 35 per new claim,
highlight paraphrase/explanation, or topic summary. With all list limits filled,
these targets total about 1,560 prose words plus titles, JSON, IDs, and any reasoning
output. This is a sizing estimate, not a tokenizer measurement or a guaranteed fit.
Schema maxima allow longer responses; a length-limited response is rejected in full.

`inference_completed` logs record numeric `prompt_tokens`, `completion_tokens`, and
`total_tokens` when the provider supplies them, plus wall-clock `elapsed_seconds`,
request schema, completion status, and token cap. No source content, credentials,
URLs, or arbitrary provider usage fields are logged. Latency covers the HTTP call
through response decoding; it excludes article fetching and persistence. A normal
finish can still fail subsequent schema/source validation; pair metrics with the
story's final `generated`/`failed` event.

**Live token use, latency, and semantic quality remain unmeasured for this prompt.**
The user requested no one-off run. No rollout claims are based on mocked timings.
During normal processing, collect the metrics for sparse and dense newly summarized
stories, record sample size/model, token and latency distributions, and inspect
stance targets, caveats, neutral evidence, and truncation failures before judging
the 8,000-token budget sufficient. The older endpoint smoke check documented in the
README predates this prompt and does not validate the expanded output.

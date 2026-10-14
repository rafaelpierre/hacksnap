# Editorial prompt evaluation

The prompt-only experiment applies the same journalistic standard to subtitles, article summaries,
legacy discussion prose and detailed topics, including topic-only refreshes. It
retains the existing JSON schemas, source-ID validation and sentiment prompt.

## Method

Run from `hacksnap/`:

```sh
uv run modal run tests/modal_editorial_smoke.py
```

The evaluator runs a temporary Modal function with the worker's `hacksnap` secret
and calls the configured, already deployed inference endpoints. It does not deploy
the worker, start a schedule, access a database or publish generated content.
Editorial requests use the production `ModalSummarizer` request format, temperature
0.2, configured reasoning effort, strict JSON schema and 32,000-token response limit.
The baseline is the prompt at commit `2285397`; the candidate uses the local prompt.

All inputs are synthetic. Cases cover a vector-search benchmark and noncomparable
personal replication, usage pricing with unknown retry billing, a short release
note containing a malicious comment instruction, missing/blocked source text, empty
comments, and a speech-model release with commercial licensing restrictions. The
speech-model case was added after revising the prompt and was not used in its examples.

Automated checks cover schema/source membership, banned source-narration, fixture
author names, a small set of contrast formulas and em dashes. They do not establish
semantic entailment, absence of every additive/contrastive construction or publication
quality. Generated outputs also receive a direct factual and editorial review.
The unavailable sentinel is excluded from prose checks because the worker consumes
it and persists a null summary rather than displaying that string.

## Iteration evidence

- [First pass](first-pass.json): all requests validated and lexical checks passed for
  candidates, but prose review found invented verification caveats, repetition and
  an unsupported claim that billing definitions did not exist.
- The second run stopped on a missing required discussion bullet. Its partial outputs
  were not saved. The harness now records expected validation/HTTP failures per case.
- [Third pass](third-pass.json) and [fourth pass](fourth-pass.json): stronger factual
  instructions improved sparse-source output, but several summaries failed validation.
- [Fifth pass](fifth-pass.json): all six initial summaries passed validation after
  consolidating prose rules and making structural requirements explicit at the end.
  Two topic refreshes returned incorrect empty-comment states. The same structural
  reminder was then added to the refresh prompt.

These failures are retained rather than treating a passing lexical check as evidence
of reliable writing. The suite is small, stochastic and partly used during prompt
revision; it is not a production-corpus quality benchmark.

## Local verification

- Worker: 470 passed, two optional PGlite integration tests skipped.
- Ruff and `git diff --check`: passed.
- Frontend under Node 22.23.3: install, lint, formatting, 458 tests across 78 suites,
  typecheck and production build passed.
- Sentiment prompt compared byte-for-byte with the baseline: unchanged.

The candidate instructions now live in `pipeline/editorial_prompts.py`, separate
from the scheduled worker's unchanged `pipeline/prompts.py`. No production prompt
change, deployment or historical backfill is part of this prototype.
See [the subsequent writer/reviewer experiment](agents-report.md).

## Final prompt-only run

The [final outputs](results.json) contain two baseline and twelve candidate generations.
Eleven candidate generations passed schema/source checks; the speech-model summary
did not complete normally. Passing lexical checks still missed an inverted "RAM
savings" title, source-narration phrased as "the tester calls", repeated summary facts,
and an unsupported assertion that retry billing remained undefined. These defects
motivated the separate evidence-review experiment; this prompt-only run did not
justify production rollout.

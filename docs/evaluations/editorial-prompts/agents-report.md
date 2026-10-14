# Writer/reviewer experiment — 10 October 2026

The bounded workflow catches errors that prompt-only generation missed, but it is
not ready to approve publication automatically. The final run accepted six of eight
cases and rejected two after one revision. Inspection against the saved sources
found residual editorial defects in accepted results, particularly repetition.
Production prompts, worker imports and publishing behavior are unchanged.

## Implementation

The optional OpenAI Agents SDK adapter calls the existing Modal endpoints:
DeepSeek-V4.1-Flash at low reasoning effort writes; GLM-5.3-Flash-NVFP4 at high effort
reviews. Python controls the sequence: write, validate, review, optionally revise
once, validate and review again. Four model calls is the maximum. Each agent has
one turn, no tools, no network research and no automatic request retries. A rejected
result contains no publishable draft; malformed schemas, evidence or completions
raise an error. There is no fallback to the unreviewed draft.

The reviewer receives the original sources and must cover every prose field with
reasoning and verbatim source evidence. Code verifies field coverage, quote
membership, citation IDs, schemas and selected writing rules. A quote's presence
cannot prove that it supports a claim: semantic judgment remains with the model.
This is source-fidelity checking, not independent verification of source claims.
SDK tracing is disabled. Evaluation output includes synthetic sources and model
responses, but no endpoint credentials.

Candidate prompts cover the subtitle (`overall_takeaway`), summary and topics:
factual leads, restrained tone, direct synthesis without commenter names, and no
source narration or formulaic additive/contrast constructions. Refreshes receive
comments only. The optional modules are separate from the production generator.

## Design and results

[Raw final run](agents-full.json) includes sources, drafts, reviews, revisions,
prompt hashes, token counts and request timings. The [rubric](../../../hacksnap/fixtures/editorial-review/rubric.json)
was not supplied to either model. Assessment below is this coding assistant's
inspection against that rubric, not an independent human or blinded evaluation.

Two cases replayed bad drafts from the earlier prompt experiment. Four additional
synthetic sources produced six generation cases, including two topic refreshes.
Quantization was also used in pilot runs; the refresh pairs share sources. These
are small, partly reused development fixtures, not eight independent holdouts.

For the six newly generated cases, the reviewed arm starts from the exact
single-pass draft. Both arms use the candidate prompts. A third arm runs the same
DeepSeek model with high reasoning effort. It is a higher-effort control, not a
separate stronger model. The saved-draft cases have no comparable generation cost
in this run and are excluded from the timing comparison below.

| Case | Workflow decision | Inspection against source and rubric |
| --- | --- | --- |
| Saved benchmark | Accepted after revision | Corrected “raises hosting costs” to “may raise”. Still repeats virtually all summary facts in key points; “draw scrutiny” retains source-narration flavor. Fails the full editorial rubric. |
| Saved pricing | Rejected after revision | Removed duplicate titles and softened the invented absence of a billing definition. Final review caught a subtitle that confuses the cap's billing protection with its availability risk. Rejection is defensible. |
| Quantization | Rejected after revision | Corrected “unmeasured costs” despite a measured throughput loss. Second review objected to lost test scope in the subtitle, although its next clause identifies the single-A100 test. This is a borderline conservative rejection; repeated key points also remain. |
| Empty comments | Accepted after revision | Removed an invented claim about absent release-note details and removed summary/key-point repetition. Meets the fixture rubric. |
| Missing source | Accepted unchanged | Preserves null article fields and the self-reported laptop measurement; ignores the injected instruction and author name. Meets the fixture rubric. |
| Missing-source refresh | Accepted unchanged | Preserves self-reporting, 2GB size and 12% improvement, but omits the laptop qualifier and uses a title without the self-reported qualification. Scope preservation needs improvement. |
| Retention refresh | Accepted after revision | Replaced “details are missing” with “remain unverified”; retains old-file inventory and uncertainty. Meets the fixture rubric. |
| Retention | Accepted after revision | Removes explicit source narration and softens the absent-details claim. Still repeats all summary facts in key points. “The stated policy does not address backup retention” infers policy scope from a short source description; wording should stay narrower. |

The six approvals therefore do not represent six publication-ready outputs. Three
accepted cases have explicit remaining rubric/editorial concerns. The reviewer
also discovered different defects on its second pass, suggesting incomplete first
reviews. Neither the approval rate nor this small inspection supports a production
accuracy estimate.

Higher reasoning alone did not solve the task: quantization still says “The replies
weigh”, the empty case invents missing compatibility details, and retention retains
repetitive prose. Sparse missing-source cases are reasonable in both approaches.
No arm consistently achieved the requested voice across this sample.

## Latency and token overhead

These totals cover the six newly generated cases, including the rejected case.
Timings sum measured inference calls per case; they exclude Modal container
startup, image build and local orchestration. Each arm ran once, without randomized
order, so endpoint load and sampling can affect comparisons.

| Arm | Calls | Input tokens | Output tokens | Median seconds per case | Range |
| --- | ---: | ---: | ---: | ---: | ---: |
| Single pass, low effort | 6 | 13,753 | 16,836 | 10.0 | 2.3–14.7 |
| Writer plus reviewer | 20 | 48,526 | 51,428 | 27.2 | 12.0–84.4 |
| Single pass, high effort | 6 | 13,753 | 16,422 | 9.6 | 3.2–20.0 |

The reviewed arm used 3.27 times the total tokens and 4.01 times the summed inference
time of low-effort generation. It accepted five of these six cases: expenditure
including rejection was approximately 19,991 tokens and 44.7 inference-seconds per
model-accepted result. This is not cost per publication-ready result. Dollars are
not estimated: endpoint token usage does not establish Modal GPU billing or the
allocation of shared serving costs. Output counts are those reported by the endpoints.

## Pilots, validation and next decision

The [low-effort reviewer pilot](agents-pilot-low-reviewer.json) falsely approved
“billing remains undefined”. The [evidence-review pilot](agents-pilot-evidence-review.json)
required revisions but then failed evidence validation. Requiring per-field
reasoning and evidence, high reviewer effort, and allowing evidence-free rejected
style fields produced the final run's six approvals and two content rejections,
with no request/schema/evidence failures. Pilot-driven tuning means these results
should not be treated as an unbiased benchmark.

Live execution used the deployed inference endpoints through a temporary Modal
app: [final run](https://modal.com/apps/rafaelpierre/main/ap-PIn0YdInTf4abM9q9Sef5Z).
No database access, publication, scheduled-worker deployment or production prompt
change occurred.

Validation: 501 worker tests passed with the optional SDK installed and PGlite
integration enabled; 17 deployment-helper tests passed; Ruff and `git diff --check`
passed. Frontend lint, formatting, 458 tests, typecheck and production build passed
under Node.js 22; frontend files were not changed. SDK tests cover actual mocked
HTTP completions, truncation, filtering and disabled retries. Workflow tests cover
bounded revision, invalid citations/evidence, missing coverage and stage failures.

Reproduce from `hacksnap/` with existing Modal authentication:

```sh
uv run --extra editorial modal run tests/modal_editorial_agents.py --suite full
```

Keep this as an experimental PR. Before connecting it to publication, evaluate a
larger unseen set of representative source lengths with independent editorial
review, explicit false-approval and false-rejection labels, and serving-cost data.
In particular, address repeated key points, evidence-scope wording and whether the
extra calls improve quality enough to justify their latency. Do not add an unbounded
agent loop to compensate for incomplete reviews.

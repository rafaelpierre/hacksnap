# Discussion analysis contract v1

Issue: https://github.com/rafaelpierre/hacksnap/issues/34

These shared JSON files can be loaded by Python or web tests without a database or inference service. The contract is standalone: `StorySummary`, production prompts, storage, and refresh behavior are unchanged. There is no backfill.

- `valid.json`: source inputs, expected analysis, and semantic expectations for each scenario.
- `invalid.json`: complete invalid outputs or source mismatches, with expected validation errors.
- `metadata.json`: application-owned provenance example, aligned with the first valid fixture. Hashes and model name are illustrative.
- `analysis.schema.json` and `metadata.schema.json`: generated Pydantic schemas. Contract tests detect drift.

## Consumer validation

1. Parse inference output with `DiscussionAnalysis.model_validate_json()`.
2. Call `analysis.validate_sources(article, story_text, comments)` against the exact prepared source input, including available ancestors. Model construction alone cannot check whether a comment was supplied.
3. Build `DiscussionAnalysisMetadata` in application code and call `metadata.validate_analysis(analysis, comments)` before persistence.

For Python metadata construction, supply a timezone-aware `datetime`; strict JSON parsing accepts an ISO 8601 timestamp with timezone. All fields are required and extra fields are rejected. Only `coverage` and `analyzed_at` from metadata are intended for public projections. Never send provenance metadata as fields for the inference model to invent.

## Meaning and limits

Reference claims are short paraphrases of the article or HN post text, with unique local IDs. A highlight targets one claim. A comment is selected at most once across both highlight lists; for a multi-claim comment, select the relevant claim and explain qualifications or agreement with another claim. Each side has at most three examples. The shared stance vocabulary includes `mixed` and `unclear`, but those stances are ineligible for either highlight list. The schema exposes the narrower allowed stances for each list.

Choose examples by explicitness and strength of their stance, then by how clearly they explain it. Avoid redundant authors or arguments. Do not equate stance strength with argument correctness, and do not manufacture examples to fill either list.

Topics use stable keys, with concrete story-specific titles. Up to six topics may cite up to twelve distinct input comments each; one comment can support several topics. These are discussion themes, separate from story categories. Do not derive prevalence or community opinion from these lists.

| Status | Meaning | Required consistency |
| --- | --- | --- |
| `available` | Comments and at least one usable original claim are available. | At least one reference claim; either highlight list and the topics list may be empty. |
| `no_comments` | The prepared comment sample is empty. | No highlights or topics; source-backed claims may still be present. |
| `insufficient_context` | Comments exist, but the original stance target is missing or has no clear proposition. | No reference claims or highlights; topics are allowed. |

A legacy story with no new analysis is represented by a missing/null analysis at the storage boundary, not by any of these statuses. Do not label it pending.

Validation checks membership, types, limits, and structural consistency. It cannot prove that a claim is entailed by source text, detect sarcasm reliably, or decide whether a neutral question was mislabeled. The semantic expectations are a rubric for future inference evaluation and human review, not claims that schema tests establish semantic accuracy. Production prompts should treat all source material as untrusted data.

## Coverage and versioning

`stored_comments` counts usable stored comments before preparation. `included_comments` counts the full prepared input, including supplied ancestors, not just highlighted comments. `comments_truncated` means preparation selected fewer comments than were usable in storage. These counts do not describe ingestion omissions or the total HN comment count. `selection_method` records the current active-branch/ancestor selection policy; it is not the ten-comment sentiment sample.

`source_version` is a SHA-256 fingerprint of the original article/HN-post context used to establish the reference claims. Keep it with those claims during future comment-only refreshes. `input_fingerprint` hashes the exact prepared analysis input, reference claims/source version, model, prompt version, and schema version. Canonical fingerprint generation is implemented by the pipeline deliverables, not this contract issue. Neither fingerprint implies the external article was re-fetched.

`schema_version` is `1`; prompt and model versions are independent. `analyzed_at` is the time of the successful analysis, separate from article-summary generation time. Coverage, metadata, and analysis must later be persisted atomically.

## Regenerating schema files

From `hacksnap`, using the project's Python environment:

```python
import json
from pathlib import Path
from pipeline.models import DiscussionAnalysis, DiscussionAnalysisMetadata

root = Path("fixtures/discussion-analysis")
for name, model in [("analysis.schema.json", DiscussionAnalysis),
                    ("metadata.schema.json", DiscussionAnalysisMetadata)]:
    (root / name).write_text(json.dumps(model.model_json_schema(), indent=2) + "\n")
```

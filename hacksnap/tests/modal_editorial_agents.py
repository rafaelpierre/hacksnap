"""Inference-only paired experiment: uv run --extra editorial modal run tests/modal_editorial_agents.py.

Default pilot checks one saved bad draft and one unseen case. --suite full evaluates
all cases. Nothing imports the worker entrypoint, reads a database or publishes prose.
"""
import json
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parents[1]
app = modal.App("hacksnap-editorial-agents-evaluation")
image = (modal.Image.debian_slim(python_version="3.12")
         .uv_sync(uv_project_dir=ROOT, extras=["editorial"])
         .add_local_python_source("pipeline"))


def generated_from_saved(output):
    value = dict(output)
    value["discussion_analysis"] = {
        key: output["discussion_analysis"][key] for key in ("status", "topics")
    }
    parts = output["discussion_summary"].split("\n\n", 1)
    value["discussion_summary"] = {
        "opening": parts[0],
        "bullets": [s.removeprefix("- ") for s in parts[1].split("\n")] if len(parts) > 1 else [],
    }
    return value


@app.function(image=image, secrets=[modal.Secret.from_name("hacksnap")],
              timeout=1500, max_containers=3)
async def evaluate_case(case):
    import hashlib
    import os
    from dataclasses import asdict
    from time import perf_counter

    from agents.exceptions import AgentsException
    from openai import OpenAIError

    from pipeline.config import SENTIMENT_BASE_URL, SENTIMENT_MODEL
    from pipeline.editorial_agents import AgentInference
    from pipeline.editorial_prompts import DISCUSSION_REFRESH_PROMPT, SYSTEM_PROMPT
    from pipeline.editorial_review import (
        REVIEW_PROMPT,
        reviewed_generation,
        validate_draft,
    )
    from pipeline.models import GeneratedDiscussionAnalysis, GeneratedStorySummary
    from pipeline.preprocess import sample_sentiment_comments

    writer_config = {
        "base_url": os.environ["MODAL_LLM_BASE_URL"], "api_key": os.environ["MODAL_LLM_API_KEY"],
        "model": os.environ["MODAL_LLM_MODEL"],
    }
    reviewer_config = {
        "base_url": os.environ.get("MODAL_SENTIMENT_BASE_URL", SENTIMENT_BASE_URL),
        "api_key": os.environ.get("MODAL_SENTIMENT_API_KEY") or os.environ["MODAL_LLM_API_KEY"],
        "model": os.environ.get("MODAL_SENTIMENT_MODEL", SENTIMENT_MODEL),
    }
    source, operation = case["source"], case["operation"]
    schema = GeneratedStorySummary if operation == "summary" else GeneratedDiscussionAnalysis
    prompt = SYSTEM_PROMPT if operation == "summary" else DISCUSSION_REFRESH_PROMPT
    payload = ({**source, "sentiment_comments": sample_sentiment_comments(source["comments"])}
               if operation == "summary" else {"comments": source["comments"]})
    writer, reviewer = AgentInference(**writer_config, capture_outputs=True), AgentInference(**reviewer_config, effort="high", capture_outputs=True)
    stronger = AgentInference(**writer_config, effort="high")
    result = {"case": case["name"], "operation": operation, "source": source, "arms": {},
              "prompt_sha256": hashlib.sha256(prompt.encode()).hexdigest(),
              "review_sha256": hashlib.sha256(REVIEW_PROMPT.encode()).hexdigest()}
    errors = (ValueError, OpenAIError, AgentsException, TimeoutError)
    try:
        started = perf_counter()
        try:
            draft = (schema.model_validate(case["draft"]) if case.get("draft") else
                     await writer.infer("writer", prompt, payload, schema))
            findings = validate_draft(draft, source, operation)
            result["arms"]["single_pass"] = {
                "status": "generated", "draft": draft.model_dump(),
                "deterministic_findings": findings,
                "elapsed_seconds": round(perf_counter() - started, 3),
            }
        except errors as exc:
            draft = None
            result["arms"]["single_pass"] = {"status": "failed", "error_type": type(exc).__name__,
                    "validation_error": str(exc)[:1500] if isinstance(exc, ValueError) else None}
        if draft is not None:
            started = perf_counter()
            try:
                reviewed = await reviewed_generation(writer, reviewer, source, operation, draft)
                result["arms"]["reviewed"] = {
                    **asdict(reviewed), "additional_seconds": round(perf_counter() - started, 3),
                }
            except errors as exc:
                result["arms"]["reviewed"] = {"status": "failed", "error_type": type(exc).__name__,
                    "validation_error": str(exc)[:1500] if isinstance(exc, ValueError) else None}
        if not case.get("draft"):
            started = perf_counter()
            try:
                draft = await stronger.infer("writer_high_reasoning", prompt, payload, schema)
                findings = validate_draft(draft, source, operation)
                result["arms"]["higher_reasoning"] = {
                    "status": "generated", "draft": draft.model_dump(),
                    "deterministic_findings": findings,
                    "elapsed_seconds": round(perf_counter() - started, 3),
                }
            except errors as exc:
                result["arms"]["higher_reasoning"] = {
                    "status": "failed", "error_type": type(exc).__name__,
                    "validation_error": str(exc)[:1500] if isinstance(exc, ValueError) else None,
                }
    finally:
        result["audit_outputs"] = writer.outputs + reviewer.outputs
        result["calls"] = writer.calls + reviewer.calls + stronger.calls
        await writer.close()
        await reviewer.close()
        await stronger.close()
    return result


@app.local_entrypoint()
def main(suite: str = "pilot"):
    from datetime import UTC, datetime

    if suite not in {"pilot", "full"}:
        raise ValueError("Use --suite pilot or --suite full")
    previous = json.loads((ROOT.parent / "docs/evaluations/editorial-prompts/results.json").read_text())
    cases = []
    for name in ("benchmark", "pricing"):
        saved = next(r for r in previous["results"]
                     if r["variant"] == "candidate" and r["case"] == name
                     and r["operation"] == "summary")
        cases.append({"name": f"saved_{name}", "source": previous["inputs"][name],
                      "operation": "summary", "draft": generated_from_saved(saved["output"])})
    fresh = json.loads((ROOT / "fixtures/editorial-review/holdouts.json").read_text())
    for name, source in fresh.items():
        cases.append({"name": name, "source": source, "operation": "summary"})
    for name in ("retention", "missing"):
        cases.append({"name": f"{name}_refresh", "source": fresh[name], "operation": "refresh"})
    if suite == "pilot":
        cases = [case for case in cases if case["name"] in {"saved_pricing", "quantization"}]
    result = {"evaluated_at": datetime.now(UTC).isoformat(), "suite": suite,
              "scope": "Synthetic inputs; no database access, publication or worker deployment.",
              "results": []}
    destination = ROOT.parent / f"docs/evaluations/editorial-prompts/agents-{suite}.json"
    for record in evaluate_case.map(cases, order_outputs=False):
        result["results"].append(record)
        destination.write_text(json.dumps(result, indent=2) + "\n")
        print(record["case"], {name: arm["status"] for name, arm in record["arms"].items()})
    print(f"Saved results to {destination}. Human evidence/style review required.")

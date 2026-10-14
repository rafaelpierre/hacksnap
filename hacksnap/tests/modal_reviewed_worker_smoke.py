"""Live production-adapter check; synthetic inputs and no database writes."""
import json
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parents[1]
app = modal.App("hacksnap-reviewed-worker-smoke")
image = modal.Image.debian_slim(python_version="3.12").uv_sync(
    uv_project_dir=ROOT,
).add_local_python_source("pipeline")


@app.function(image=image, secrets=[modal.Secret.from_name("hacksnap")],
              timeout=700, max_containers=3)
def check(case):
    from time import perf_counter

    import httpx

    from pipeline.config import Settings
    from pipeline.reviewed_summarise import EditorialRejected, ReviewedSummarizer
    from pipeline.summarise import ModalSummarizer, RoutedSummarizer

    settings = Settings.from_env()
    started = perf_counter()
    with httpx.Client(timeout=settings.llm_timeout) as client:
        model = RoutedSummarizer(ReviewedSummarizer(settings), ModalSummarizer(
            client, settings.sentiment_base_url, settings.sentiment_model,
            settings.sentiment_api_key or settings.llm_api_key, settings.sentiment_reasoning_effort,
        ))
        result = {"case": case["name"], "operation": case["operation"],
                  "model": model.model, "prompt_version": model.prompt_version,
                  "discussion_prompt_version": model.discussion_prompt_version}
        try:
            value = (model.summarize(case["source"]) if case["operation"] == "summary"
                     else model.refresh_discussion(case["source"]))
            result.update(status="accepted", output=value.model_dump(mode="json"))
        except EditorialRejected:
            result.update(status="rejected")
        result["elapsed_seconds"] = round(perf_counter() - started, 3)
        return result


@app.local_entrypoint()
def main():
    sources = json.loads((ROOT / "fixtures/editorial-review/holdouts.json").read_text())
    cases = [{"name": name, "source": sources[name], "operation": operation}
             for name, operation in [("empty", "summary"), ("missing", "summary"),
                                     ("retention", "refresh")]]
    results = list(check.map(cases))
    path = ROOT.parent / "docs/evaluations/editorial-prompts/production-adapter.json"
    path.write_text(json.dumps({"scope": "Synthetic sources; no database access or publication.",
                               "results": results}, indent=2) + "\n")
    for result in results:
        print(result["case"], result["status"], result["elapsed_seconds"])

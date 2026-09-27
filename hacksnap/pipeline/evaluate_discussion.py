"""Read-only live semantic evaluation of the shared synthetic fixtures.

Run with: uv run python -m pipeline.evaluate_discussion --help
No database, article fetcher, production refresh, or retention job is invoked.
"""
import argparse
import json
import os
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from urllib.parse import urlsplit

import httpx

from .models import DISCUSSION_ANALYSIS_SCHEMA_VERSION, DiscussionAnalysis
from .prompts import DISCUSSION_REFRESH_PROMPT_VERSION, PROMPT_VERSION
from .refresh import discussion_source
from .summarise import ModalSummarizer

FIXTURES = Path(__file__).parents[1] / "fixtures/discussion-analysis/valid.json"


def modal_cli_transport(request: httpx.Request) -> httpx.Response:
    """Use existing CLI auth; never put credentials or source text in argv."""
    result = subprocess.run(
        ["modal", "curl", "--silent", "--show-error", "--fail-with-body",
         "--max-time", "180", "-H", "Content-Type: application/json",
         "-H", f"Modal-Session-Id: {request.headers['Modal-Session-Id']}",
         "--data-binary", "@-", str(request.url)],
        input=request.content, capture_output=True, timeout=200, check=False,
    )
    if result.returncode:
        # curl stderr/body may contain private provider diagnostics.
        raise RuntimeError("Authenticated evaluation request failed")
    return httpx.Response(200, content=result.stdout, request=request)


def evaluate_case(fixture: dict, mode: str, summarizer) -> dict:
    started = perf_counter()
    record = {
        "case": fixture["id"], "mode": mode,
        "semantic_expectations": fixture["semantic_expectations"],
        "semantic_review": "pending",
    }
    try:
        source = fixture["inputs"]
        if mode == "initial":
            result = summarizer.summarize({
                **source, "title": "Engine performance discussion", "article_url": None,
            })
            analysis = result.discussion_analysis
        else:
            # Isolate refresh quality using the fixture's established claims.
            analysis = DiscussionAnalysis.model_validate(fixture["expected"])
            count = len(source["comments"])
            result = summarizer.refresh_discussion(discussion_source(
                source["comments"],
                {"stored_comments": count, "included_comments": count,
                 "comments_truncated": False},
                analysis, "synthetic-fixture",
            ))
            analysis = result
        record.update(
            validation="passed",
            output=result.model_dump(mode="json"),
            output_characters=len(result.model_dump_json()),
            analysis_characters=len(analysis.model_dump_json()),
        )
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError, RuntimeError,
            subprocess.SubprocessError) as error:
        record.update(validation="failed", error_type=type(error).__name__)
    record["elapsed_seconds"] = round(perf_counter() - started, 3)
    return record


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model", required=True)
    parser.add_argument("--modal-cli", action="store_true",
                        help="Authenticate with the existing Modal CLI profile")
    parser.add_argument("--output", type=Path, required=True,
                        help="New JSON report path; existing files are never overwritten")
    parser.add_argument("--case", action="append", dest="cases",
                        help="Fixture ID; repeat to select cases (default: all)")
    args = parser.parse_args()
    endpoint = urlsplit(args.base_url)
    if (endpoint.scheme != "https" or not endpoint.hostname or endpoint.username
            or endpoint.password or endpoint.query or endpoint.fragment):
        parser.error("--base-url must be a credential-free HTTPS base URL")
    if args.modal_cli and not endpoint.hostname.endswith((".modal.direct", ".modal.run")):
        parser.error("--modal-cli requires a Modal endpoint")
    key = os.environ.get("MODAL_LLM_API_KEY", "")
    if not args.modal_cli and not key:
        parser.error("Set MODAL_LLM_API_KEY or use --modal-cli")
    fixtures = json.loads(FIXTURES.read_text())
    if args.cases:
        unknown = set(args.cases) - {fixture["id"] for fixture in fixtures}
        if unknown:
            parser.error(f"Unknown fixture IDs: {', '.join(sorted(unknown))}")
        fixtures = [fixture for fixture in fixtures if fixture["id"] in args.cases]
    report = {
        "evaluated_at": datetime.now(UTC).isoformat(),
        "model": args.model, "initial_prompt": PROMPT_VERSION,
        "refresh_prompt": DISCUSSION_REFRESH_PROMPT_VERSION,
        "schema_version": DISCUSSION_ANALYSIS_SCHEMA_VERSION,
        "scope": "synthetic fixtures only; no production reads or writes",
        "timing": "client wall time; includes CLI authentication when selected",
        "results": [],
    }
    transport = httpx.MockTransport(modal_cli_transport) if args.modal_cli else None
    # Reserve the report before spending inference calls. Checkpoint every result.
    with args.output.open("x") as output, httpx.Client(transport=transport, timeout=180) as client:
        summarizer = ModalSummarizer(client, args.base_url.rstrip("/"), args.model, key)
        for fixture in fixtures:
            for mode in ("initial", "refresh"):
                record = evaluate_case(fixture, mode, summarizer)
                report["results"].append(record)
                output.seek(0)
                json.dump(report, output, indent=2)
                output.write("\n")
                output.truncate()
                output.flush()
                print(f"{fixture['id']} {mode}: {record['validation']}", flush=True)
    # Structural success still requires human review of targets, caveats, and context.
    return int(any(row["validation"] != "passed" for row in report["results"]))


if __name__ == "__main__":
    raise SystemExit(main())

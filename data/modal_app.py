"""Deploy from data/: uv run modal deploy modal_app.py."""

from pathlib import Path

import modal

ROOT = Path(__file__).parent
app = modal.App("hn-ingestion")
image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_sync(uv_project_dir=ROOT)
    .add_local_python_source("hn_trending")
)


@app.function(
    image=image,
    schedule=modal.Cron("17 8-23 * * *"),
    secrets=[modal.Secret.from_name(
        "hacksnap", required_keys=["SUPABASE_PASSWORD", "MODAL_LLM_API_KEY"]
    )],
    timeout=1500,
    max_containers=1,
)
def ingest():
    import os

    from hn_trending.cli import main
    from hn_trending.topic_filter import MODAL_LLM_BASE_URL, MODAL_LLM_MODEL

    # Reuse credentials, but do not inherit another app's model selection.
    os.environ["MODAL_LLM_BASE_URL"] = MODAL_LLM_BASE_URL
    os.environ["MODAL_LLM_MODEL"] = MODAL_LLM_MODEL
    main(args=[
        "--limit", "20", "--min-points", "20", "--min-comments", "20",
        "--max-comment-depth", "5", "--min-comment-descendants", "3",
        "--classify-topic",
    ], standalone_mode=False)

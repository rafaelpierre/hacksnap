"""Manual backfill app, isolated from the scheduled ingestion function."""

from pathlib import Path

import modal

ROOT = Path(__file__).parent
app = modal.App("hn-category-backfill")
image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_sync(uv_project_dir=ROOT)
    .add_local_python_source("hn_trending")
)


@app.function(
    image=image,
    secrets=[modal.Secret.from_name(
        "hacksnap", required_keys=["SUPABASE_PASSWORD", "MODAL_LLM_API_KEY"]
    )],
    timeout=3600,
    max_containers=1,
)
def backfill_categories(limit: int = 0, dry_run: bool = False):
    """Manually categorize existing titles using the ingestion credentials; safe to resume."""
    import os

    from hn_trending.backfill_categories import main
    from hn_trending.topic_filter import MODAL_LLM_BASE_URL, MODAL_LLM_MODEL

    os.environ["MODAL_LLM_BASE_URL"] = MODAL_LLM_BASE_URL
    os.environ["MODAL_LLM_MODEL"] = MODAL_LLM_MODEL
    args = ["--limit", str(limit)] if limit else []
    if dry_run:
        args.append("--dry-run")
    main(args=args, standalone_mode=False)

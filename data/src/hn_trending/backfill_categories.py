"""Resumable category backfill; never changes story membership or raw content."""

import os

import click

from hn_trending.categories import category_metadata, reusable_category
from hn_trending.cli import resolve_database_url
from hn_trending.storage import category_backfill_batch, save_category
from hn_trending.topic_filter import MODAL_LLM_BASE_URL, MODAL_LLM_MODEL, TitleTopicClassifier


@click.command()
@click.option("--limit", type=click.IntRange(min=1), default=None, help="Maximum titles to classify this run.")
@click.option("--dry-run", is_flag=True, help="Predict and print categories without saving them.")
def main(limit: int | None, dry_run: bool) -> None:
    """Categorize stored titles, skipping current predictions and committing each success."""
    key = os.environ.get("MODAL_LLM_API_KEY")
    if not key:
        raise click.UsageError("Set MODAL_LLM_API_KEY.")
    classifier = TitleTopicClassifier(key,
        base_url=os.environ.get("MODAL_LLM_BASE_URL", MODAL_LLM_BASE_URL),
        model=os.environ.get("MODAL_LLM_MODEL", MODAL_LLM_MODEL))
    database_url = resolve_database_url()
    after_id = processed = saved = 0
    while rows := category_backfill_batch(database_url, after_id):
        for row in rows:
            after_id = row["hn_id"]
            if reusable_category(row, row["title"], classifier.model):
                continue
            decision = classifier.classify(row["title"], already_relevant=True)
            if not decision.relevant:
                raise click.ClickException(f"Classifier rejected an already admitted story {after_id}.")
            metadata = category_metadata(row["title"], decision.category, classifier.model)
            written = False if dry_run else save_category(database_url, after_id, row["title"], metadata)
            processed += 1
            saved += int(written)
            click.echo(f"{after_id}\t{decision.category}\t{row['title']}" +
                       (" [preview]" if dry_run else "" if written else " [changed concurrently; skipped]"))
            if limit is not None and processed >= limit:
                click.echo(f"Classified {processed}; saved {saved}.")
                return
    click.echo(f"Classified {processed}; saved {saved}.")


if __name__ == "__main__":
    main()

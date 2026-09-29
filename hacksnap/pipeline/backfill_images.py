"""Bounded, restartable image backfill using the normal leased image processor."""

import argparse
import json
import logging
import os
import time
from collections.abc import Callable
from functools import partial
from urllib.parse import urlsplit

from .config import database_url_from_env

logger = logging.getLogger("hacksnap")


def backfill_images(
    repository,
    uploader,
    *,
    process_job: Callable,
    limit: int = 25,
    after_id: int = 0,
    publisher_interval: float = 2.0,
    include_failed: bool = False,
    reprocess_ready: bool = False,
    dry_run: bool = False,
    settings=None,
    clock: Callable = time.monotonic,
    sleep: Callable = time.sleep,
) -> dict:
    """Process one finite page, one claim at a time; committed ready rows are checkpoints.

    Rerun with the default cursor to recover interrupted rows after their lease
    expires. The optional cursor helps operators scan a large collection, but a
    skipped row may still need retrying in a later pass from zero.
    """
    if not 1 <= limit <= 100:
        raise ValueError("limit must be between 1 and 100")
    if after_id < 0:
        raise ValueError("after_id must be nonnegative")
    if not 1 <= publisher_interval <= 10:
        raise ValueError("publisher_interval must be between 1 and 10 seconds")
    rows = repository.list_image_candidates(
        limit=limit,
        after_id=after_id,
        include_failed=include_failed,
        reprocess_ready=reprocess_ready,
        max_attempts=settings.max_attempts if settings else 3,
    )
    counts = {
        "selected": len(rows), "processed": 0, "publisher_derived": 0,
        "generated": 0, "failed": 0, "skipped": 0, "next_after_id": after_id,
        "dry_run": dry_run,
    }
    previous_start: dict[str, float] = {}
    for row in rows:
        story_id = row["story_id"]
        if dry_run:
            counts["next_after_id"] = story_id
            continue
        try:
            host = (urlsplit(row.get("article_url") or "").hostname or "").lower()
        except ValueError:
            host = ""
        if host and host in previous_start:
            delay = publisher_interval - (clock() - previous_start[host])
            if delay > 0:
                sleep(delay)
        job = None
        try:
            repository.enqueue_image(
                story_id, row.get("article_url"),
                force=include_failed and row.get("image_status") != "ready",
                reprocess_ready=reprocess_ready,
            )
            jobs = repository.claim_pending_images(
                limit=1, story_ids=[story_id],
                max_attempts=settings.max_attempts if settings else 3,
                lease_seconds=settings.lease_seconds(publisher_interval) if settings else 300,
            )
            if not jobs:
                counts["skipped"] += 1
            else:
                job = jobs[0]
                if host:
                    previous_start[host] = clock()
                counts["processed"] += 1
                result = process_job(job, repository, uploader, settings=settings)
                if result == "publisher":
                    counts["publisher_derived"] += 1
                elif result in {"generated", "failed", "skipped"}:
                    counts[result] += 1
                else:
                    raise ValueError("Unknown image processor result")
        except Exception as error:  # noqa: BLE001 - one story must not stop the batch
            counts["failed"] += 1
            if job is not None:
                try:
                    repository.mark_image_failed(
                        story_id, job["lease_token"], "backfill_processor_failed", retryable=True,
                    )
                except Exception:  # noqa: BLE001 - lease expiry is the recovery path
                    logger.warning(json.dumps({
                        "event": "image_backfill_recovery_deferred", "article_id": story_id,
                        "failure_reason": "persistence_failed",
                    }))
            logger.warning(json.dumps({
                "event": "image_backfill_story_failed", "article_id": story_id,
                "failure_reason": "backfill_processor_failed", "error_type": type(error).__name__,
            }))
        counts["next_after_id"] = story_id
        logger.info(json.dumps({"event": "image_backfill_progress", **counts}))
    logger.info(json.dumps({"event": "image_backfill_completed", **counts}))
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=25, help="Maximum stories, 1–100")
    parser.add_argument("--after-id", type=int, default=0, help="Optional ascending story ID cursor")
    parser.add_argument("--publisher-interval", type=float, default=2.0,
                        help="Minimum seconds between jobs for the same publisher, 1–10")
    parser.add_argument("--include-failed", action="store_true",
                        help="Explicitly retry exhausted failures after fixing their cause")
    parser.add_argument("--reprocess-ready", action="store_true",
                        help="Explicitly replace ready images; preserve them until success")
    parser.add_argument("--dry-run", action="store_true", help="Select only, without writes or requests")
    args = parser.parse_args(argv)
    if not 1 <= args.limit <= 100 or args.after_id < 0 or not 1 <= args.publisher_interval <= 10:
        parser.error("Use --limit 1–100, --after-id >= 0, and --publisher-interval 1–10")
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    from .supabase import Repository

    repository = Repository(database_url_from_env())
    # Runtime imports are below the dry-run branch so inspection requires no Blob token.
    if args.dry_run:
        counts = backfill_images(repository, None, process_job=None, **vars(args))
    else:
        from .blob import VercelBlobStore
        from .image_metadata import PublicFetcher
        from .images.worker import ImageSettings, process_image_job

        settings = ImageSettings.from_env()
        token = os.environ.get("BLOB_READ_WRITE_TOKEN")
        if not token:
            parser.error("Set BLOB_READ_WRITE_TOKEN for image processing")
        uploader = VercelBlobStore(token)
        fetcher = PublicFetcher(
            settings.timeout, settings.max_redirects, publisher_interval=args.publisher_interval,
        )
        counts = backfill_images(
            repository, uploader, process_job=partial(process_image_job, fetcher=fetcher),
            settings=settings, **vars(args),
        )
    print(json.dumps(counts))
    return 1 if counts["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

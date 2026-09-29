"""Bounded image backfill and scheduled queue drain."""

import argparse
import json
import logging
import os
import threading
import time
from functools import partial
from urllib.parse import urlsplit

from ..image_scope import BACKFILL_END, BACKFILL_START, scope_result
from ..supabase import Repository
from .ingest import ImageIngester

logger = logging.getLogger("hacksnap.images")
STATUSES = ("ready", "failed", "skipped", "superseded")


class HostRateLimiter:
    """Space requests to the same publisher host, including redirect targets."""

    def __init__(self, interval_seconds: float = 2):
        if interval_seconds < 0:
            raise ValueError("Publisher interval must be nonnegative")
        self.interval_seconds = interval_seconds
        self._last_request: dict[str, float] = {}
        self._lock = threading.Lock()

    def __call__(self, url: str) -> None:
        host = urlsplit(url).hostname
        if not host:
            raise ValueError("Publisher request requires a host")
        with self._lock:
            now = time.monotonic()
            previous = self._last_request.get(host)
            if previous is not None:
                delay = previous + self.interval_seconds - now
                if delay > 0:
                    time.sleep(delay)
                    now = time.monotonic()
            self._last_request[host] = now


def run_batch(
    repository: Repository, ingester: ImageIngester, limit: int = 10, *,
    max_attempts: int = 3, stale_after_seconds: int = 900,
    retry_after_seconds: int = 3600,
) -> dict[str, int | str | None]:
    """Scan once and process at most `limit` articles; retries wait for another run."""
    if not 1 <= limit <= 100:
        raise ValueError("Image backfill limit must be between 1 and 100")
    candidates = repository.list_unqueued_image_candidates(
        limit, max_attempts=max_attempts, stale_after_seconds=stale_after_seconds,
        retry_after_seconds=retry_after_seconds,
        added_from=BACKFILL_START, added_before=BACKFILL_END,
    )
    counts = {"scanned": len(candidates), **dict.fromkeys(STATUSES, 0), **scope_result()}
    for candidate in candidates:
        try:
            status = ingester.ingest_article_image(candidate["hn_id"], candidate["url"])
        except Exception:  # noqa: BLE001 - one article cannot stop the scheduled batch
            logger.error('{"event":"article_image_batch","reason":"unexpected_ingester_error"}')
            status = "failed"
        if status not in STATUSES:
            raise ValueError(f"Unknown image ingestion status: {status}")
        counts[status] += 1
    return counts


def run(limit: int | None = None) -> dict:
    """Run the legacy CLI through the fixed-day durable queue backfill."""
    from ..backfill_images import backfill_images
    from ..blob import VercelBlobStore
    from ..config import database_url_from_env
    from ..image_metadata import PublicFetcher
    from .worker import ImageSettings as WorkerSettings
    from .worker import process_image_job

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    settings = WorkerSettings.from_env()
    batch_limit = settings.batch_size if limit is None else limit
    if not 1 <= batch_limit <= 100:
        raise ValueError("Image backfill limit must be between 1 and 100")
    token = os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip()
    if not token:
        raise ValueError("Set BLOB_READ_WRITE_TOKEN for the image worker")
    fetcher = PublicFetcher(
        settings.timeout, settings.max_redirects,
        publisher_interval=settings.publisher_interval,
    )
    return backfill_images(
        Repository(database_url_from_env()), VercelBlobStore(token),
        process_job=partial(process_image_job, fetcher=fetcher),
        limit=batch_limit, publisher_interval=settings.publisher_interval,
        settings=settings,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Process articles added on 29 September 2026 in Europe/London",
    )
    parser.add_argument("--limit", type=int, help="maximum stories in this batch (1–100)")
    args = parser.parse_args(argv)
    if args.limit is not None and not 1 <= args.limit <= 100:
        parser.error("--limit must be between 1 and 100")
    result = run(args.limit)
    print(json.dumps(result, sort_keys=True))
    return 1 if result["failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

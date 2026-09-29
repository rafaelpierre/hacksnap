"""Bounded image backfill and scheduled queue drain."""

import argparse
import json
import logging
import threading
import time
from urllib.parse import urlsplit

from ..supabase import Repository
from .config import ImageSettings
from .ingest import ImageIngester
from .upload import BlobUploader

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
) -> dict[str, int]:
    """Scan once and process at most `limit` articles; retries wait for another run."""
    if not 1 <= limit <= 100:
        raise ValueError("Image backfill limit must be between 1 and 100")
    candidates = repository.list_image_candidates(
        limit, max_attempts=max_attempts, stale_after_seconds=stale_after_seconds,
        retry_after_seconds=retry_after_seconds,
    )
    counts = {"scanned": len(candidates), **dict.fromkeys(STATUSES, 0)}
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
    """Run one bounded batch using independent image-worker credentials."""
    logging.basicConfig(level=logging.INFO)
    logger.setLevel(logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    settings = ImageSettings.from_env()
    batch_limit = settings.batch_size if limit is None else limit
    if not 1 <= batch_limit <= 100:
        raise ValueError("Image backfill limit must be between 1 and 100")
    repository = Repository(settings.database_url)
    ingester = ImageIngester(
        repository, BlobUploader(settings.blob_token), limits=settings.limits,
        max_attempts=settings.max_attempts,
        stale_after_seconds=settings.stale_after_seconds,
        retry_after_seconds=settings.retry_after_seconds,
        before_request=HostRateLimiter(settings.publisher_interval_seconds),
    )
    counts = run_batch(
        repository, ingester, batch_limit, max_attempts=settings.max_attempts,
        stale_after_seconds=settings.stale_after_seconds,
        retry_after_seconds=settings.retry_after_seconds,
    )
    result = {**counts, "failure_reasons": dict(ingester.failure_counts)}
    logger.info(json.dumps({"event": "article_image_batch_complete", **result}, sort_keys=True))
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Process one bounded article-image batch")
    parser.add_argument("--limit", type=int, help="maximum stories in this batch (1–100)")
    args = parser.parse_args()
    print(json.dumps(run(args.limit), sort_keys=True))


if __name__ == "__main__":
    main()

"""Independent image lifecycle used by both the scheduled worker and backfill."""

import json
import logging
from collections import Counter
from collections.abc import Callable
from datetime import UTC, datetime
from urllib.parse import urlsplit, urlunsplit

from . import ImageError, ImageLimits, discover_og, fetch_html, fetch_image, normalize_image

logger = logging.getLogger("hacksnap.images")


def safe_url(value: str | None) -> str | None:
    if not value:
        return None
    try:
        parsed = urlsplit(value)
        return urlunsplit((parsed.scheme, parsed.hostname or "", parsed.path, "", ""))
    except ValueError:
        return "[invalid URL]"


def image_event(hn_id, article_url, status, *, source_url=None, reason=None):
    event = {
        "event": "article_image", "timestamp": datetime.now(UTC).isoformat(),
        "article_id": hn_id, "article_url": safe_url(article_url),
        "image_source_url": safe_url(source_url),
        "image_source_type": "og" if source_url else None,
        "status": status, "reason": reason,
    }
    logger.log(logging.WARNING if reason else logging.INFO, json.dumps(event))


class ImageIngester:
    def __init__(
        self, repository, uploader, *, limits: ImageLimits | None = None,
        max_attempts: int = 3, stale_after_seconds: int = 900,
        retry_after_seconds: int = 3600, before_request: Callable[[str], None] | None = None,
    ):
        self.repository = repository
        self.uploader = uploader
        self.limits = limits or ImageLimits()
        self.claim_options = {
            "max_attempts": max_attempts, "stale_after_seconds": stale_after_seconds,
            "retry_after_seconds": retry_after_seconds,
        }
        self.before_request = before_request
        self.failure_counts: Counter[str] = Counter()

    def ingest_article_image(
        self, article_id: int, article_url: str, html: str | None = None, *, replace: bool = False,
    ) -> str:
        """Return ready/failed/skipped/superseded; never affect article publication.

        The database is the durable queue. Claim/finalize errors leave any saved lease
        to expire, so a worker crash or database outage is recoverable on another run.
        """
        token = None
        source_url = None
        reason = None
        try:
            token = self.repository.claim_image_attempt(
                article_id, replace=replace, **self.claim_options,
            )
            if not token:
                image_event(article_id, article_url, "skipped")
                return "skipped"
            image_event(article_id, article_url, "pending")
            if html is None:
                html = fetch_html(
                    article_url, self.limits, before_request=self.before_request,
                )
            # MVP tries the highest-priority Open Graph candidate. Multi-candidate
            # Twitter/JSON-LD/generated fallbacks are explicitly tracked in #65.
            source_url = discover_og(html, article_url)[0]
            raw = fetch_image(source_url, self.limits, before_request=self.before_request)
            data, width, height = normalize_image(raw, self.limits)
            image_url = self.uploader.upload(article_id, data)
            saved = self.repository.save_image_ready(
                article_id, token, image_url=image_url, image_source_url=source_url,
                image_source_type="og", image_width=width, image_height=height,
                image_mime_type="image/webp",
            )
            status = "ready" if saved else "superseded"
            image_event(article_id, article_url, status, source_url=source_url)
            return status
        except ImageError as error:
            reason = error.reason
        except Exception:  # noqa: BLE001 - isolate image failures from publication
            reason = "image_pipeline_failed"
        if token:
            try:
                saved = self.repository.save_image_failed(
                    article_id, token, reason=reason, image_source_url=source_url,
                    image_source_type="og" if source_url else None,
                )
                if not saved:
                    image_event(article_id, article_url, "superseded", source_url=source_url)
                    return "superseded"
            except Exception:  # noqa: BLE001 - retain lease for recovery; never leak DB errors
                reason = "image_persistence_failed"
        self.failure_counts[reason] += 1
        image_event(article_id, article_url, "failed", source_url=source_url, reason=reason)
        return "failed"

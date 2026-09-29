"""Independent, failure-isolated image jobs for published stories."""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import io
import json
import logging
import math
import os
import re
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from contextvars import copy_context
from dataclasses import dataclass
from time import perf_counter
from urllib.parse import urlsplit

from PIL import Image, ImageDraw, ImageFont, ImageOps, UnidentifiedImageError

from ..image_metadata import ImageFetchError, PublicFetcher, extract_candidates, safe_url
from ..image_scope import BACKFILL_START, scope_result

logger = logging.getLogger("hacksnap.images")
Image.MAX_IMAGE_PIXELS = 30_000_000

_HTML_TYPES = ("text/html", "application/xhtml+xml")
_IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp", "image/gif")
_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp", "GIF": "image/gif"}


@dataclass(frozen=True)
class ImageSettings:
    min_width: int = 600
    min_height: int = 300
    width: int = 1200
    height: int = 630
    max_html_bytes: int = 1_000_000
    max_image_bytes: int = 8_000_000
    max_candidates: int = 12
    timeout: float = 8.0
    max_redirects: int = 3
    max_attempts: int = 3
    batch_size: int = 10
    concurrency: int = 4
    publisher_interval: float = 2.0

    def lease_seconds(self, publisher_interval: float = 1.0) -> int:
        """Cover a complete attempt, including redirects and courtesy waits."""
        upper_bound = (1 + self.max_candidates) * (
            self.timeout + (self.max_redirects + 1) * publisher_interval
        ) + 120
        return max(300, math.ceil(upper_bound))

    @classmethod
    def from_env(cls) -> ImageSettings:
        defaults = cls()

        def integer(name: str, default: int, low: int, high: int) -> int:
            value = int(os.environ.get(name, default))
            if not low <= value <= high:
                raise ValueError(f"{name} must be between {low} and {high}")
            return value

        return cls(
            concurrency=integer("HACKSNAP_IMAGE_CONCURRENCY", defaults.concurrency, 1, 8),
            batch_size=integer("HACKSNAP_IMAGE_BATCH_SIZE", defaults.batch_size, 1, 100),
            publisher_interval=float(integer("HACKSNAP_IMAGE_PUBLISHER_INTERVAL", int(defaults.publisher_interval), 0, 10)),
            min_width=integer("HACKSNAP_IMAGE_MIN_WIDTH", defaults.min_width, 300, 2400),
            min_height=integer("HACKSNAP_IMAGE_MIN_HEIGHT", defaults.min_height, 150, 1200),
            max_html_bytes=integer("HACKSNAP_IMAGE_MAX_HTML_BYTES", os.environ.get("HACKSNAP_IMAGE_HTML_MAX_BYTES", defaults.max_html_bytes), 1024, 2_000_000),
            max_image_bytes=integer("HACKSNAP_IMAGE_MAX_BYTES", defaults.max_image_bytes, 1024, 16_000_000),
            max_candidates=integer("HACKSNAP_IMAGE_MAX_CANDIDATES", defaults.max_candidates, 1, 20),
            max_attempts=integer("HACKSNAP_IMAGE_MAX_ATTEMPTS", defaults.max_attempts, 1, 10),
            timeout=float(integer("HACKSNAP_IMAGE_TIMEOUT", os.environ.get("HACKSNAP_IMAGE_TIMEOUT_SECONDS", defaults.timeout), 1, 30)),
            max_redirects=integer("HACKSNAP_IMAGE_MAX_REDIRECTS", defaults.max_redirects, 0, 5),
        )


def _log(job: dict, candidate_url: str | None, source_type: str, reason: str) -> None:
    logger.warning(json.dumps({
        "article_id": job["story_id"],
        "article_url": safe_url(job.get("article_url")),
        "candidate_image_url": safe_url(candidate_url),
        "source_type": source_type,
        "failure_reason": reason,
        "status": "failed",
    }))


def _log_ready(job: dict, candidate_url: str | None, source_type: str) -> None:
    logger.info(json.dumps({
        "article_id": job["story_id"],
        "article_url": safe_url(job.get("article_url")),
        "candidate_image_url": safe_url(candidate_url),
        "source_type": source_type,
        "status": "ready",
    }))


def _reason(error: ImageFetchError) -> str:
    code = str(error)
    if code in {"timeout", "dns_failure", "network_error"}:
        return "fetch_timeout" if code == "timeout" else "fetch_network_error"
    if code in {"invalid_url", "private_address"}:
        return "blocked_url"
    if code in {"too_large", "too_many_pixels"}:
        return "image_too_large"
    if code == "undersized_image":
        return "image_too_small"
    if code in {"unsupported_mime", "misleading_mime", "unsupported_encoding"}:
        return "invalid_content_type"
    if code == "invalid_image":
        return "decode_failed"
    if re.fullmatch(r"http_[1-5][0-9]{2}", code):
        return code
    return "fetch_failed"


def normalize_image(data: bytes, mime_type: str, settings: ImageSettings) -> bytes:
    """Decode and crop to the canonical WebP size after MIME and pixel checks."""
    try:
        with Image.open(io.BytesIO(data)) as source:
            source_format = source.format
            if _FORMATS.get(source_format) != mime_type:
                raise ImageFetchError("misleading_mime")
            if source.width < settings.min_width or source.height < settings.min_height:
                raise ImageFetchError("undersized_image")
            if source.width * source.height > Image.MAX_IMAGE_PIXELS:
                raise ImageFetchError("too_many_pixels")
            source.load()
            image = ImageOps.exif_transpose(source).convert("RGB")
    except ImageFetchError:
        raise
    except Image.DecompressionBombError as exc:
        raise ImageFetchError("too_many_pixels") from exc
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ImageFetchError("invalid_image") from exc
    image = ImageOps.fit(image, (settings.width, settings.height), method=Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    image.save(buffer, format="WEBP", quality=84, method=5)
    return buffer.getvalue()


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = (
        ["/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf", "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
        if bold else
        ["/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf", "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    )
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default(size=size)


def _measure(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> int:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0]


def _wrap(draw: ImageDraw.ImageDraw, title: str, font: ImageFont.ImageFont, width: int) -> list[str]:
    """Wrap by words, then grapheme-like character runs for long unspaced text."""
    lines: list[str] = []
    current = ""
    for word in title.split(" "):
        candidate = f"{current} {word}".strip()
        if _measure(draw, candidate, font) <= width:
            current = candidate
            continue
        if current:
            lines.append(current)
            current = ""
        for char in word:
            if _measure(draw, current + char, font) > width and current:
                lines.append(current)
                current = ""
            current += char
    if current:
        lines.append(current)
    return lines


def generate_artwork(job: dict, settings: ImageSettings) -> bytes:
    """Deterministic branded card; no inference or remote assets."""
    width, height = settings.width, settings.height
    title = re.sub(r"\s+", " ", (job.get("title") or "Untitled story")[:500]).strip()
    # Noto CJK covers the scripts in titles but bitmap emoji support varies by host.
    # Use a visible marker instead of letting unsupported emoji render as tofu boxes.
    title = "".join(
        "✦" if 0x1F000 <= ord(char) <= 0x1FAFF else
        "" if ord(char) in {0x200D, 0xFE0E, 0xFE0F} else char
        for char in title
    )
    digest = hashlib.sha256(f"{job['story_id']}:{title}".encode()).digest()
    image = Image.new("RGB", (width, height), "#111314")
    draw = ImageDraw.Draw(image)
    # Fixed geometric texture varies by story but remains stable on retry.
    for index in range(12):
        x = digest[index] * width // 255
        y = digest[index + 12] * height // 255
        radius = 12 + digest[index + 4] % 55
        draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill="#181c1d")
    margin = 64
    orange = "#efaa7b"
    gray = "#aeb5b3"
    draw.text((margin, 43), "h/", font=_font(40, True), fill=orange)
    draw.text((margin + 56, 48), "hacksnap", font=_font(30, True), fill="#f2f3f2")
    draw.text((width - margin, 55), "AI / HACKER NEWS", anchor="ra", font=_font(17), fill=gray)
    domain = urlsplit(job.get("article_url") or "").hostname or "Hacker News"
    label = (job.get("category") or domain).upper()
    if len(label) > 55:
        label = label[:52] + "…"
    draw.rectangle((margin, 147, margin + 27, 150), fill=orange)
    draw.text((margin + 40, 134), label, font=_font(22), fill=orange)
    max_title_width = width - 2 * margin
    for font_size in (70, 62, 54, 46, 40):
        font = _font(font_size, True)
        lines = _wrap(draw, title, font, max_title_width)
        if len(lines) <= 4 and len(lines) * int(font_size * 1.18) <= 285:
            break
    if len(lines) > 4:
        lines = lines[:4]
        while lines[-1] and _measure(draw, lines[-1] + "…", font) > max_title_width:
            lines[-1] = lines[-1][:-1]
        lines[-1] += "…"
    line_height = int(font_size * 1.18)
    top = 205 + max(0, (290 - len(lines) * line_height) // 2)
    for line in lines:
        draw.text((margin, top), line, font=font, fill="#f2f3f2")
        top += line_height
    draw.line((margin, 548, width - margin, 548), fill="#454a4b", width=2)
    draw.text((margin, 571), domain[:70], font=_font(18), fill=gray)
    draw.text((width - margin, 571), "hacksnap.live", anchor="ra", font=_font(19, True), fill=orange)
    output = io.BytesIO()
    image.save(output, format="WEBP", quality=84, method=5)
    return output.getvalue()


def _call(value):
    return asyncio.run(value) if inspect.isawaitable(value) else value


def _discard_upload(uploader, url: str | None) -> None:
    if not url or not hasattr(uploader, "delete"):
        return
    try:
        _call(uploader.delete(url))
    except Exception:  # noqa: BLE001 - orphan cleanup cannot change the job result
        logger.warning("image_orphan_cleanup_failed")


def process_image_job(
    job: dict, repository, uploader, *, settings: ImageSettings | None = None,
    fetcher: PublicFetcher | None = None,
) -> str:
    """Process a claimed row without ever raising into the summary publication path."""
    settings = settings or ImageSettings()
    fetcher = fetcher or PublicFetcher(settings.timeout, settings.max_redirects, publisher_interval=settings.publisher_interval)
    story_id, lease_token = job["story_id"], job["lease_token"]
    article_url = job.get("article_url")
    if article_url:
        try:
            html_bytes, final_url, _ = fetcher.get(
                article_url, settings.max_html_bytes, accepted_types=_HTML_TYPES
            )
            candidates = extract_candidates(html_bytes.decode("utf-8", "replace"), final_url)
        except Exception as exc:  # noqa: BLE001 - malformed source falls back to artwork
            reason = _reason(exc) if isinstance(exc, ImageFetchError) else "metadata_error"
            _log(job, None, "publisher", reason)
            candidates = []
        if not candidates:
            _log(job, None, "publisher", "no_image_metadata")
        for candidate in candidates[:settings.max_candidates]:
            try:
                content, _final_url, mime = fetcher.get(
                    candidate.url, settings.max_image_bytes, accepted_types=_IMAGE_TYPES
                )
                webp = normalize_image(content, mime, settings)
            except ImageFetchError as exc:
                _log(job, candidate.url, candidate.source_type, _reason(exc))
                continue
            except Exception:  # noqa: BLE001 - one malformed candidate cannot abort the job
                _log(job, candidate.url, candidate.source_type, "candidate_invalid")
                continue
            try:
                uploaded = _call(uploader.upload_webp(story_id, webp))
            except Exception:  # noqa: BLE001 - upload errors are retried
                _log(job, candidate.url, candidate.source_type, "blob_upload_failed")
                _mark_failed(job, repository, "blob_upload_failed")
                return "failed"
            try:
                ready = repository.mark_image_ready(
                    story_id, lease_token, uploaded, candidate.source_type,
                    source_url=candidate.url, width=settings.width, height=settings.height,
                    mime_type="image/webp",
                )
            except Exception as exc:  # noqa: BLE001 - DB may have committed; retain upload
                _log(job, candidate.url, candidate.source_type, type(exc).__name__)
                try:
                    if repository.is_image_url_current(story_id, uploaded):
                        _log_ready(job, candidate.url, candidate.source_type)
                        return "publisher"
                    # A negative read cannot prove a lost commit will never finish.
                    # Keep the immutable upload until an operator reconciles it.
                except Exception:  # noqa: BLE001 - keep URL when outcome is uncertain
                    logger.warning("image_commit_outcome_uncertain")
                _mark_failed(job, repository, "publisher_persist_uncertain")
                return "failed"
            if ready:
                _log_ready(job, candidate.url, candidate.source_type)
                return "publisher"
            _discard_upload(uploader, uploaded)
            _log(job, candidate.url, candidate.source_type, "stale_lease")
            return "skipped"
    try:
        webp = generate_artwork(job, settings)
    except Exception:  # noqa: BLE001 - image errors never fail an article
        _log(job, None, "generated", "generation_failed")
        _mark_failed(job, repository, "generation_failed")
        return "failed"
    try:
        uploaded = _call(uploader.upload_webp(story_id, webp))
    except Exception:  # noqa: BLE001 - storage failures remain independently retryable
        _log(job, None, "generated", "blob_upload_failed")
        _mark_failed(job, repository, "blob_upload_failed")
        return "failed"
    try:
        ready = repository.mark_image_ready(
            story_id, lease_token, uploaded, "generated", source_url=None,
            width=settings.width, height=settings.height, mime_type="image/webp",
        )
    except Exception as exc:  # noqa: BLE001 - DB commit may have succeeded
        _log(job, None, "generated", type(exc).__name__)
        try:
            if repository.is_image_url_current(story_id, uploaded):
                _log_ready(job, None, "generated")
                return "generated"
            # Keep an uncertain upload even if it is not visible to this read yet.
        except Exception:  # noqa: BLE001 - keep URL when outcome is uncertain
            logger.warning("image_commit_outcome_uncertain")
        _mark_failed(job, repository, "generation_persist_uncertain")
        return "failed"
    if ready:
        _log_ready(job, None, "generated")
        return "generated"
    _discard_upload(uploader, uploaded)
    _log(job, None, "generated", "stale_lease")
    return "skipped"


def _mark_failed(job: dict, repository, reason: str) -> None:
    try:
        repository.mark_image_failed(
            job["story_id"], job["lease_token"], reason, retryable=True
        )
    except Exception as exc:  # noqa: BLE001 - preserve the original failure
        _log(job, None, "storage", type(exc).__name__)


def process_pending_images(
    repository, uploader, *, limit: int = 10, settings: ImageSettings | None = None,
    fetcher: PublicFetcher | None = None,
) -> dict[str, int | str | None]:
    """Claim pending and expired image leases, including jobs from earlier runs."""
    started = perf_counter()
    settings = settings or ImageSettings()
    if not 1 <= settings.concurrency <= 8:
        raise ValueError("Image concurrency must be between 1 and 8")
    counts = {"publisher": 0, "generated": 0, "failed": 0, "skipped": 0,
              **scope_result(scheduled=True)}
    fetcher = fetcher or PublicFetcher(settings.timeout, settings.max_redirects, publisher_interval=settings.publisher_interval)
    # Shared-host pacing can involve every active worker. Fail before touching
    # the queue if custom settings exceed the repository's supported lease cap.
    lease_seconds = settings.lease_seconds(
        getattr(fetcher, "publisher_interval", 1.0) * settings.concurrency,
    )
    if lease_seconds > 3600:
        raise ValueError("Image concurrency and fetch settings require a lease longer than 3600 seconds")
    # A summary can commit even if its initial enqueue fails. Reconcile published
    # stories on every independent sweep so the missing queue row is recovered.
    for candidate in repository.list_image_candidates(
        limit=max(limit, 100), max_attempts=settings.max_attempts,
        added_from=BACKFILL_START,
    ):
        try:
            repository.enqueue_image(
                candidate["story_id"], candidate["article_url"], added_from=BACKFILL_START,
            )
        except Exception as exc:  # noqa: BLE001 - one DB row must not stop others
            _log(candidate, None, "queue", type(exc).__name__)
    def process(job):
        job_started = perf_counter()
        try:
            result = process_image_job(job, repository, uploader, settings=settings, fetcher=fetcher)
        except Exception as exc:  # noqa: BLE001 - recover next claimed job
            _log(job, None, "worker", type(exc).__name__)
            _mark_failed(job, repository, "worker_failed")
            result = "failed"
        logger.info(json.dumps({
            "event": "image_job_completed", "story_id": job["story_id"],
            "status": result, "elapsed_seconds": round(perf_counter() - job_started, 3),
        }))
        return result

    processed = 0
    exhausted = False
    with ThreadPoolExecutor(max_workers=settings.concurrency) as executor:
        pending = set()
        while pending or (processed < limit and not exhausted):
            # Claim only free worker slots, never a batch waiting on the executor.
            while len(pending) < settings.concurrency and processed < limit and not exhausted:
                claimed = repository.claim_pending_images(
                    limit=1, max_attempts=settings.max_attempts,
                    lease_seconds=lease_seconds,
                    added_from=BACKFILL_START,
                )
                if not claimed:
                    exhausted = True
                    break
                processed += 1
                pending.add(executor.submit(copy_context().run, process, claimed[0]))
            if pending:
                completed, pending = wait(pending, return_when=FIRST_COMPLETED)
                for future in completed:
                    counts[future.result()] += 1
    elapsed = perf_counter() - started
    logger.info(json.dumps({
        "event": "image_batch_completed", "processed": processed,
        "concurrency": settings.concurrency, "elapsed_seconds": round(elapsed, 3),
        "items_per_minute": round(processed * 60 / elapsed, 3) if elapsed else 0,
        **counts,
    }))
    return counts

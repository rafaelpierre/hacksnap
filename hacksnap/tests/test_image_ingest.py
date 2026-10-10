import json
from io import BytesIO
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from PIL import Image

from pipeline.images import ImageError, ingest, upload
from pipeline.images.config import ImageSettings
from pipeline.images.ingest import ImageIngester
from pipeline.images.upload import BlobUploader, canonical_blob_url

CANONICAL = "https://store.public.blob.vercel-storage.com/articles/100/hero-unique.webp"


def setup_ingester(monkeypatch):
    repository = Mock()
    repository.claim_image_attempt.return_value = "lease-token"
    repository.save_image_ready.return_value = True
    repository.save_image_failed.return_value = True
    uploader = Mock()
    uploader.upload.return_value = CANONICAL
    image = BytesIO()
    Image.effect_mandelbrot((1200, 600), (-2, -1, 1, 1), 32).save(image, format="PNG")
    monkeypatch.setattr(ingest, "fetch_html", Mock(return_value=(
        '<meta property="og:image" content="/hero.png?secret=hidden">'
    )))
    monkeypatch.setattr(ingest, "fetch_image", Mock(return_value=image.getvalue()))
    return repository, uploader, ImageIngester(repository, uploader)


def test_candidate_to_canonical_metadata_smoke(monkeypatch, caplog):
    repo, uploader, worker = setup_ingester(monkeypatch)
    with caplog.at_level("INFO"):
        assert worker.ingest_article_image(100, "https://publisher.example/a?token=private") == "ready"
    data = uploader.upload.call_args.args[1]
    with Image.open(BytesIO(data)) as decoded:
        assert decoded.format == "WEBP"
        assert decoded.size == (1200, 600)
    repo.save_image_ready.assert_called_once_with(
        100, "lease-token", image_url=CANONICAL,
        image_source_url="https://publisher.example/hero.png?secret=hidden",
        image_source_type="og", image_width=1200, image_height=600, image_mime_type="image/webp",
    )
    event = json.loads(caplog.records[-1].message)
    assert event["status"] == "ready" and event["article_id"] == 100
    assert "hidden" not in caplog.text and "private" not in caplog.text
    repo.save_fetch_failure.assert_not_called()


@pytest.mark.parametrize("reason", [
    "no_image_metadata", "fetch_timeout", "http_403", "http_404", "invalid_content_type",
    "image_too_large", "image_too_small", "decode_failed", "blocked_url", "blob_upload_failed",
])
def test_image_failures_stay_out_of_article_fetch_failure_path(monkeypatch, caplog, reason):
    repo, uploader, worker = setup_ingester(monkeypatch)
    uploader.upload.side_effect = ImageError(reason)
    assert worker.ingest_article_image(100, "https://publisher.example/a") == "failed"
    assert repo.save_image_failed.call_args.kwargs["reason"] == reason
    assert worker.failure_counts == {reason: 1}
    repo.save_fetch_failure.assert_not_called()
    repo.save_summary.assert_not_called()


def test_blank_image_is_failed_without_upload_or_publication(monkeypatch):
    repo, uploader, worker = setup_ingester(monkeypatch)
    blank = BytesIO()
    Image.new("RGB", (1200, 630), "white").save(blank, "PNG")
    monkeypatch.setattr(ingest, "fetch_image", Mock(return_value=blank.getvalue()))
    assert worker.ingest_article_image(100, "https://publisher.example/a") == "failed"
    assert repo.save_image_failed.call_args.kwargs["reason"] == "image_too_few_bytes"
    uploader.upload.assert_not_called()
    repo.save_image_ready.assert_not_called()
    repo.save_fetch_failure.assert_not_called()


def test_missing_metadata_finishes_failed(monkeypatch):
    repo, uploader, worker = setup_ingester(monkeypatch)
    assert worker.ingest_article_image(100, "https://publisher.example/a", html="<html/>") == "failed"
    assert repo.save_image_failed.call_args.kwargs["reason"] == "no_image_metadata"
    uploader.upload.assert_not_called()


def test_claim_skips_completed_or_concurrent_attempts(monkeypatch):
    repo, uploader, worker = setup_ingester(monkeypatch)
    repo.claim_image_attempt.return_value = None
    assert worker.ingest_article_image(100, "https://publisher.example/a") == "skipped"
    ingest.fetch_html.assert_not_called()
    uploader.upload.assert_not_called()


def test_supplied_html_avoids_duplicate_fetch(monkeypatch):
    _repo, _uploader, worker = setup_ingester(monkeypatch)
    assert worker.ingest_article_image(
        100, "https://publisher.example/a", '<meta property="og:image" content="/x.png">',
    ) == "ready"
    ingest.fetch_html.assert_not_called()


def test_lost_lease_does_not_overwrite_newer_result(monkeypatch):
    repo, _uploader, worker = setup_ingester(monkeypatch)
    repo.save_image_ready.return_value = False
    assert worker.ingest_article_image(100, "https://publisher.example/a") == "superseded"
    repo.save_image_failed.assert_not_called()


def test_persistence_failure_is_sanitized_and_leaves_recovery_to_lease(monkeypatch, caplog):
    repo, _uploader, worker = setup_ingester(monkeypatch)
    repo.save_image_ready.side_effect = RuntimeError("credential secret")
    repo.save_image_failed.side_effect = RuntimeError("credential secret")
    assert worker.ingest_article_image(100, "https://user:pass@publisher.example/a?token=hidden") == "failed"
    assert "credential" not in caplog.text and "hidden" not in caplog.text
    assert "image_persistence_failed" in caplog.text


def test_blob_sdk_upload_bytes_random_suffix_and_close(monkeypatch):
    client = Mock()
    client.__enter__ = Mock(return_value=client)
    client.__exit__ = Mock(return_value=None)
    client.put.return_value = SimpleNamespace(url=CANONICAL)
    constructor = Mock(return_value=client)
    monkeypatch.setattr(upload, "BlobClient", constructor)
    assert BlobUploader("test-token").upload(100, b"webp") == CANONICAL
    constructor.assert_called_once_with(token="test-token")
    client.put.assert_called_once_with(
        "articles/100/hero.webp", b"webp", access="public", content_type="image/webp",
        add_random_suffix=True, overwrite=False, cache_control_max_age=31536000,
    )
    client.__exit__.assert_called_once()


@pytest.mark.parametrize("url", [
    "https://publisher.example/hero.webp", "http://store.public.blob.vercel-storage.com/articles/x",
    "https://store.public.blob.vercel-storage.com.evil.example/articles/x",
    "https://user@store.public.blob.vercel-storage.com/articles/x",
    "https://store.public.blob.vercel-storage.com/articles/x?token=secret",
])
def test_canonical_upload_validation(url):
    assert not canonical_blob_url(url)


def test_image_config_needs_no_inference_credentials(monkeypatch):
    monkeypatch.setenv("HACKSNAP_DATABASE_URL", "postgresql://local/test")
    monkeypatch.setenv("BLOB_READ_WRITE_TOKEN", "private-test-token")
    for key in ("MODAL_LLM_BASE_URL", "MODAL_LLM_MODEL", "MODAL_LLM_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    settings = ImageSettings.from_env()
    assert settings.batch_size == 10 and settings.limits.min_width == 600
    assert "private-test-token" not in repr(settings)
    monkeypatch.setenv("HACKSNAP_IMAGE_BATCH_SIZE", "100000")
    with pytest.raises(ValueError):
        ImageSettings.from_env()


def test_blob_sdk_error_is_controlled(monkeypatch):
    monkeypatch.setattr(upload, "BlobClient", Mock(side_effect=RuntimeError("token=private")))
    with pytest.raises(ImageError, match="^blob_upload_failed$"):
        BlobUploader("private").upload(100, b"webp")


def test_disabled_image_schedule_needs_no_database_or_inference(monkeypatch):
    import modal_app

    monkeypatch.delenv("BLOB_READ_WRITE_TOKEN", raising=False)
    assert modal_app.refresh_article_images.local() == {"status": "disabled"}


def test_malformed_candidate_is_a_blocked_url(monkeypatch):
    repo, _uploader, worker = setup_ingester(monkeypatch)
    assert worker.ingest_article_image(
        100, "https://publisher.example/a", '<meta property="og:image" content="http://[bad">',
    ) == "failed"
    assert repo.save_image_failed.call_args.kwargs["reason"] == "blocked_url"


def test_image_config_rejects_rate_wait_longer_than_fetch_deadline(monkeypatch):
    monkeypatch.setenv("HACKSNAP_DATABASE_URL", "postgresql://local/test")
    monkeypatch.setenv("BLOB_READ_WRITE_TOKEN", "test-token")
    monkeypatch.setenv("HACKSNAP_IMAGE_PUBLISHER_INTERVAL", "10")
    with pytest.raises(ValueError, match="interval must be shorter"):
        ImageSettings.from_env()

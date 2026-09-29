"""Image queue, compare-and-set, and Blob adapter contracts without live services."""

import sys
import types
from unittest.mock import MagicMock

import pytest

from pipeline.blob import VercelBlobStore
from pipeline.supabase import Repository


@pytest.fixture
def database(monkeypatch):
    connect = MagicMock()
    connection = connect.return_value.__enter__.return_value
    connection.execute.return_value.rowcount = 1
    monkeypatch.setattr("pipeline.supabase.psycopg.connect", connect)
    return Repository("postgresql://mock.invalid/test"), connection


def test_enqueue_is_published_only_and_never_reopens_failures_implicitly(database):
    repo, connection = database
    assert repo.enqueue_image(42, "https://example.com/article")
    sql, params = connection.execute.call_args.args
    assert "EXISTS (SELECT 1 FROM hacksnap_summaries" in sql
    assert "t.url IS NOT DISTINCT FROM %(article_url)s" in sql
    assert "t.image_status IS NULL OR %(force)s" in sql
    assert "t.image_attempt_token IS NULL" in sql
    assert params["force"] is False
    assert params["reprocess_ready"] is False
    assert repo.enqueue_image(42, "https://example.com/article", force=True)
    assert connection.execute.call_args.args[1]["force"] is True


def test_claims_use_row_locks_tokens_and_recover_expired_final_attempt(database):
    repo, connection = database
    connection.execute.return_value.fetchall.return_value = [{"story_id": 42}]
    assert repo.claim_pending_images(story_ids=[42]) == [{"story_id": 42}]
    assert connection.execute.call_count == 3
    reconcile_sql = connection.execute.call_args_list[0].args[0]
    cleanup_sql = connection.execute.call_args_list[1].args[0]
    claim_sql, params = connection.execute.call_args_list[2].args
    assert "NOT image_queue_managed" in reconcile_sql
    assert "image_attempt_token = NULL" in reconcile_sql
    assert "image_queued_at = NULL" in cleanup_sql
    assert "image_attempts >= %s" in cleanup_sql
    assert "FOR UPDATE OF t SKIP LOCKED" in claim_sql
    assert "image_lease_token = gen_random_uuid()" in claim_sql
    assert "image_attempts = t.image_attempts + 1" in claim_sql
    assert "t.hn_id = ANY(%(story_ids)s::bigint[])" in claim_sql
    assert params["story_ids"] == [42]


def test_completion_requires_matching_lease_and_preserves_asset_on_failure(database):
    repo, connection = database
    url = "https://store.public.blob.vercel-storage.com/articles/42/hero-abc.webp"
    assert repo.mark_image_ready(42, "00000000-0000-0000-0000-000000000001", url,
                                 "generated", width=1200, height=630)
    sql = connection.execute.call_args.args[0]
    assert "image_lease_token = %(lease_token)s::uuid" in sql
    assert "url IS NOT DISTINCT FROM image_requested_url" in sql
    assert "image_url = %(image_url)s" in sql
    connection.execute.return_value.rowcount = 0
    assert not repo.mark_image_ready(42, "00000000-0000-0000-0000-000000000001", url,
                                     "generated", width=1200, height=630)
    assert not repo.mark_image_failed(42, "00000000-0000-0000-0000-000000000001",
                                      "upload failed")
    fail_sql = connection.execute.call_args.args[0]
    assert "WHEN image_url IS NULL THEN 'failed' ELSE 'ready'" in fail_sql
    assert "image_url =" not in fail_sql
    connection.execute.return_value.fetchone.return_value = {"?column?": 1}
    assert repo.is_image_url_current(42, url)
    assert connection.execute.call_args.args[1] == (42, url)
    connection.execute.return_value.fetchone.return_value = None
    assert not repo.is_image_url_current(42, url)


def test_blob_adapter_uploads_immutable_public_webp_and_deletes_by_url(monkeypatch):
    client = MagicMock()
    client.put.return_value.url = (
        "https://store.public.blob.vercel-storage.com/articles/42/hero-abc.webp"
    )
    module = types.ModuleType("vercel")
    blob_module = types.ModuleType("vercel.blob")
    blob_module.BlobClient = lambda **kwargs: client
    monkeypatch.setitem(sys.modules, "vercel", module)
    monkeypatch.setitem(sys.modules, "vercel.blob", blob_module)
    client.__enter__.return_value = client
    store = VercelBlobStore("secret")
    url = store.upload_webp(42, b"RIFF")
    assert url == client.put.return_value.url
    client.put.assert_called_once_with(
        "articles/42/hero.webp", b"RIFF", access="public", content_type="image/webp",
        add_random_suffix=True, overwrite=False, cache_control_max_age=31536000,
    )
    store.delete(url)
    client.delete.assert_called_once_with(url)
    with pytest.raises(ValueError, match="non-article"):
        store.delete("https://example.com/elsewhere.webp")

"""Exercise the installed SDK and adapter credentials without contacting Blob."""

import os

import httpx2
import pytest
import vercel.api
from vercel.blob.errors import BlobAccessError

from pipeline.blob import VercelBlobStore
from pipeline.images import ImageError
from pipeline.images.upload import BlobUploader

TOKEN = "vercel_blob_rw_store_test-secret"
URL = "https://store.public.blob.vercel-storage.com/articles/42/hero-abc.webp"


@pytest.mark.parametrize("adapter", [VercelBlobStore, BlobUploader])
@pytest.mark.parametrize("fail", [False, True])
def test_blob_sdk_uses_explicit_credentials_and_closes_transport(monkeypatch, adapter, fail):
    monkeypatch.setenv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_other_wrong-secret")
    requests = []
    clients = []

    def respond(request):
        requests.append(request)
        if fail:
            return httpx2.Response(403, json={"error": {"code": "forbidden"}})
        return httpx2.Response(200, json={
            "url": URL,
            "downloadUrl": URL,
            "pathname": "articles/42/hero-abc.webp",
            "contentType": "image/webp",
            "contentDisposition": "inline",
            "etag": '"test-etag"',
        })

    def http_client():
        client = httpx2.Client(transport=httpx2.MockTransport(respond))
        clients.append(client)
        return client

    session = vercel.api.session
    monkeypatch.setattr(vercel.api, "session", lambda **kwargs: session(
        **kwargs, httpx_client_factory=http_client,
    ))
    store = adapter(TOKEN)
    upload = store.upload_webp if isinstance(store, VercelBlobStore) else store.upload
    if fail:
        error = ImageError if isinstance(store, BlobUploader) else BlobAccessError
        with pytest.raises(error):
            upload(42, b"webp")
    else:
        assert upload(42, b"webp") == URL
        assert requests[0].read() == b"webp"
        if isinstance(store, VercelBlobStore):
            store.delete(URL)
    assert requests
    assert all(request.headers["authorization"] == f"Bearer {TOKEN}" for request in requests)
    assert os.environ["BLOB_READ_WRITE_TOKEN"] == "vercel_blob_rw_other_wrong-secret"
    assert clients and all(client.is_closed for client in clients)

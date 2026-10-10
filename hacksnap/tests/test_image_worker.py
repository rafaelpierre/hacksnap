import http.client
import io
import json
import socket
import threading

import pytest
from PIL import Image

from pipeline.image_metadata import ImageFetchError, PublicFetcher, extract_candidates, public_url
from pipeline.image_scope import BACKFILL_START, scope_result
from pipeline.images.worker import (
    ImageSettings,
    generate_artwork,
    normalize_image,
    process_image_job,
    process_pending_images,
)


def make_image(width=900, height=600, image_format="PNG"):
    output = io.BytesIO()
    Image.effect_mandelbrot((width, height), (-2, -1, 1, 1), 32).save(output, format=image_format)
    return output.getvalue()


def test_metadata_order_relative_urls_and_malformed_jsonld():
    html = """<html><head>
    <meta name="twitter:image" content="/twitter.png">
    <meta property="og:image:url" content="/og.png">
    <meta property="og:image:secure_url" content="https://cdn.example/og2.png">
    <meta property="og:image" content="/og.png">
    <script type="application/ld+json">broken</script>
    <script type="application/ld+json">{"@graph":[{"image":[{"url":"/schema.png"}]}]}</script>
    </head></html>"""
    assert [(c.source_type, c.url) for c in extract_candidates(html, "https://example.com/story")] == [
        ("og", "https://example.com/og.png"),
        ("og", "https://cdn.example/og2.png"),
        ("twitter", "https://example.com/twitter.png"),
        ("json_ld", "https://example.com/schema.png"),
    ]


@pytest.mark.parametrize("url", [
    "http://localhost/foo", "http://127.0.0.1/foo", "http://user:pass@example.com/x",
    "http://example.com:8080/x", "file:///etc/passwd", "http://host.internal/x",
])
def test_private_or_invalid_urls_are_rejected(url):
    with pytest.raises(ImageFetchError):
        public_url(url)


@pytest.mark.parametrize("url", [
    "https://example.com/\\@127.0.0.1/",
    "https://example.com/has space",
    "https://example.com/\nprivate",
    "http://[::ffff:127.0.0.1]/",
])
def test_ambiguous_and_mapped_urls_are_rejected_before_connecting(url):
    with pytest.raises(ImageFetchError):
        public_url(url)


def test_tunneled_private_ipv6_dns_result_is_rejected(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [
        (socket.AF_INET6, socket.SOCK_STREAM, 0, "", ("2002:c0a8:101::", 443)),
    ])
    with pytest.raises(ImageFetchError, match="private_address"):
        PublicFetcher().get("https://example.com/", 100, accepted_types=("text/html",))


def test_dns_rebinding_blocks_any_private_result(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [
        (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.215.14", 80)),
        (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("127.0.0.1", 80)),
    ])
    with pytest.raises(ImageFetchError, match="private_address"):
        PublicFetcher().get("http://example.com/", 100, accepted_types=("text/html",))


@pytest.mark.parametrize("address", ["224.0.0.1", "239.255.255.250", "ff02::1"])
def test_multicast_dns_answer_never_connects(monkeypatch, address):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [
        (socket.AF_INET6 if ":" in address else socket.AF_INET, socket.SOCK_STREAM,
         0, "", (address, 80)),
    ])
    with pytest.raises(ImageFetchError, match="private_address"):
        PublicFetcher(publisher_interval=0).get(
            "http://example.com/", 100, accepted_types=("text/html",)
        )


@pytest.mark.parametrize("size,mime,reason", [
    ((500, 400), "image/png", "undersized_image"),
    ((900, 600), "image/jpeg", "misleading_mime"),
])
def test_decode_validation(size, mime, reason):
    with pytest.raises(ImageFetchError, match=reason):
        normalize_image(make_image(*size), mime, ImageSettings())


def test_normalize_crops_to_webp():
    data = normalize_image(make_image(), "image/png", ImageSettings())
    with Image.open(io.BytesIO(data)) as image:
        assert image.format == "WEBP"
        assert image.size == (1200, 630)


class FakeFetcher:
    def __init__(self, html, images):
        self.html = html
        self.images = images
        self.calls = []

    def get(self, url, max_bytes, *, accepted_types):
        self.calls.append(url)
        if "text/html" in accepted_types:
            return self.html.encode(), url, "text/html"
        value = self.images[url]
        if isinstance(value, Exception):
            raise value
        return value, url, "image/png"


class FakeUploader:
    def __init__(self, fail=False):
        self.uploaded = []
        self.deleted = []
        self.fail = fail

    def upload_webp(self, story_id, data):
        if self.fail:
            raise RuntimeError("private credentials must not leak")
        self.uploaded.append(data)
        return f"https://blob.example/{story_id}/{len(self.uploaded)}"

    def delete(self, url):
        self.deleted.append(url)


class FakeRepository:
    def __init__(self, ready=True):
        self.ready = ready
        self.saved = []
        self.failed = []

    def mark_image_ready(self, *args, **kwargs):
        self.saved.append((args, kwargs))
        return self.ready

    def mark_image_failed(self, *args, **kwargs):
        self.failed.append((args, kwargs))


def job(**kwargs):
    return {
        "story_id": 123, "lease_token": "lease", "article_url": "https://example.com/story",
        "title": "Long Unicode: Café — 東京 AI", "category": "AI", **kwargs,
    }


def test_rejects_bad_og_then_uses_twitter():
    html = '<meta property="og:image" content="/og.png"><meta name="twitter:image" content="/tw.png">'
    fetcher = FakeFetcher(html, {
        "https://example.com/og.png": ImageFetchError("http_403"),
        "https://example.com/tw.png": make_image(),
    })
    repository, uploader = FakeRepository(), FakeUploader()
    assert process_image_job(job(), repository, uploader, fetcher=fetcher) == "publisher"
    assert repository.saved[0][0][3] == "twitter"
    assert repository.saved[0][1]["source_url"] == "https://example.com/tw.png"


def test_redirected_download_keeps_original_metadata_url():
    class RedirectingFetcher(FakeFetcher):
        def get(self, url, max_bytes, *, accepted_types):
            body, final_url, mime = super().get(url, max_bytes, accepted_types=accepted_types)
            if "text/html" not in accepted_types:
                final_url = "https://cdn.example/final.png"
            return body, final_url, mime

    fetcher = RedirectingFetcher('<meta property="og:image" content="/original.png">', {
        "https://example.com/original.png": make_image(),
    })
    repository = FakeRepository()
    assert process_image_job(job(), repository, FakeUploader(), fetcher=fetcher) == "publisher"
    assert repository.saved[0][1]["source_url"] == "https://example.com/original.png"


def test_malformed_candidate_does_not_block_lower_priority_candidate():
    html = '<meta property="og:image" content="/bad path.png"><meta name="twitter:image" content="/good.png">'
    fetcher = FakeFetcher(html, {
        "https://example.com/bad path.png": http.client.InvalidURL("bad path"),
        "https://example.com/good.png": make_image(),
    })
    repository = FakeRepository()
    assert process_image_job(job(), repository, FakeUploader(), fetcher=fetcher) == "publisher"
    assert repository.saved[0][0][3] == "twitter"


def test_blank_og_is_logged_and_next_candidate_is_published(caplog):
    blank = io.BytesIO()
    Image.new("RGB", (1200, 630), "white").save(blank, "PNG")
    fetcher = FakeFetcher(
        '<meta property="og:image" content="/blank.png">'
        '<meta name="twitter:image" content="/good.png">',
        {"https://example.com/blank.png": blank.getvalue(),
         "https://example.com/good.png": make_image()},
    )
    repository, uploader = FakeRepository(), FakeUploader()
    assert process_image_job(job(), repository, uploader, fetcher=fetcher) == "publisher"
    assert repository.saved[0][0][3] == "twitter"
    assert len(uploader.uploaded) == 1
    assert "image_too_few_bytes" in caplog.text


def test_invalid_publisher_images_only_publish_a_hidden_generated_fallback():
    fetcher = FakeFetcher('<meta property="og:image" content="/bad.png">', {
        "https://example.com/bad.png": b"not an image",
    })
    repository, uploader = FakeRepository(), FakeUploader()
    assert process_image_job(job(), repository, uploader, fetcher=fetcher) == "generated"
    assert len(uploader.uploaded) == 1
    assert repository.saved[0][0][3] == "generated"


@pytest.mark.parametrize("corrupt", [False, True])
def test_generated_output_must_pass_qa_before_upload(monkeypatch, corrupt):
    blank = io.BytesIO()
    Image.new("RGB", (1200, 630), "white").save(blank, "WEBP")
    monkeypatch.setattr("pipeline.images.worker.generate_artwork",
                        lambda *_: b"broken" if corrupt else blank.getvalue())
    repository, uploader = FakeRepository(), FakeUploader()
    assert process_image_job(job(article_url=None), repository, uploader) == "failed"
    assert repository.saved == []
    assert uploader.uploaded == []
    assert repository.failed[0][0][2] == (
        "decode_failed" if corrupt else "image_too_few_bytes"
    )


def test_generated_unicode_and_missing_fields():
    story = job()
    story.update(title="世界のニュース 🛰️ " * 35, article_url=None, category=None)
    data = generate_artwork(story, ImageSettings())
    assert data == generate_artwork(story, ImageSettings())
    with Image.open(io.BytesIO(data)) as image:
        assert image.format == "WEBP"
        assert image.size == (1200, 630)
    repository, uploader = FakeRepository(), FakeUploader()
    assert process_image_job(story, repository, uploader) == "generated"
    assert repository.saved[0][0][3] == "generated"


def test_upload_failure_marks_retry_and_never_publishes(caplog):
    fetcher = FakeFetcher('<meta property="og:image" content="/og.png">', {
        "https://example.com/og.png": make_image(),
    })
    repository, uploader = FakeRepository(), FakeUploader(fail=True)
    assert process_image_job(job(), repository, uploader, fetcher=fetcher) == "failed"
    assert repository.failed[0][0][2] == "blob_upload_failed"
    assert repository.saved == []
    assert "private credentials" not in caplog.text


def test_stale_lease_discards_new_upload_only():
    repository, uploader = FakeRepository(ready=False), FakeUploader()
    story = job(previous_image_url="https://blob.example/old")
    story["article_url"] = None
    assert process_image_job(story, repository, uploader) == "skipped"
    assert uploader.deleted == ["https://blob.example/123/1"]


def test_structured_logs_redact_queries(caplog):
    story = job()
    story["article_url"] += "?token=secret"
    fetcher = FakeFetcher('<meta property="og:image" content="/bad.png?key=secret">', {
        "https://example.com/bad.png?key=secret": ImageFetchError("http_403"),
    })
    process_image_job(story, FakeRepository(), FakeUploader(), fetcher=fetcher)
    assert "secret" not in caplog.text
    assert json.loads(caplog.records[0].message)["candidate_image_url"] in (
        "", "https://example.com/bad.png"
    )


def test_sweep_reconciles_missing_queue_entry_and_claims_one_at_a_time():
    class QueueRepository(FakeRepository):
        def __init__(self):
            super().__init__()
            self.enqueued = []
            self.claim_limits = []
            self.issued = False

        def list_image_candidates(self, **kwargs):
            return [{"story_id": 123, "article_url": None}]

        def enqueue_image(self, story_id, article_url, *, added_from):
            self.enqueued.append((story_id, article_url, added_from))

        def claim_pending_images(self, *, limit, max_attempts, lease_seconds, added_from):
            self.claim_limits.append((limit, added_from))
            if self.issued:
                return []
            self.issued = True
            story = job()
            story["article_url"] = None
            return [story]

    repository = QueueRepository()
    counts = process_pending_images(repository, FakeUploader(), limit=3)
    assert counts == {
        "publisher": 0, "generated": 1, "failed": 0, "skipped": 0,
        **scope_result(scheduled=True),
    }
    assert repository.enqueued == [(123, None, BACKFILL_START)]
    assert repository.claim_limits == [(1, BACKFILL_START), (1, BACKFILL_START)]


def test_public_fetcher_paces_repeated_requests_for_same_host(monkeypatch):
    from pipeline import image_metadata

    current = [0.0]
    sleeps = []

    def sleep(seconds):
        sleeps.append(seconds)
        current[0] += seconds

    class Response:
        status = 200

        def getheader(self, name, default=None):
            return {"Content-Type": "text/html", "Content-Length": "2"}.get(name, default)

        def isclosed(self):
            return False

        def read1(self, size):
            if hasattr(self, "read_once"):
                return b""
            self.read_once = True
            return b"ok"

    class Connection:
        sock = None

        def __init__(self, *args, **kwargs):
            pass

        def request(self, *args, **kwargs):
            pass

        def getresponse(self):
            return Response()

        def close(self):
            pass

    monkeypatch.setattr(image_metadata.socket, "getaddrinfo", lambda *a, **k: [
        (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.215.14", 80)),
    ])
    monkeypatch.setattr(image_metadata.http.client, "HTTPConnection", Connection)
    fetcher = PublicFetcher(timeout=1, publisher_interval=2, clock=lambda: current[0], sleep=sleep)
    fetcher.get("http://example.com/one", 100, accepted_types=("text/html",))
    fetcher.get("http://example.com/two", 100, accepted_types=("text/html",))
    assert sleeps == [2]


def test_public_fetcher_rejects_redirect_to_private_address(monkeypatch):
    from pipeline import image_metadata

    connections = []

    class Response:
        status = 302

        def getheader(self, name, default=None):
            return "http://127.0.0.1/private" if name == "Location" else default

    class Connection:
        def __init__(self, *args, **kwargs):
            connections.append(args)

        def request(self, *args, **kwargs):
            pass

        def getresponse(self):
            return Response()

        def close(self):
            pass

    def resolve(host, port, **kwargs):
        address = "127.0.0.1" if host == "127.0.0.1" else "93.184.215.14"
        return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", (address, port))]

    monkeypatch.setattr(image_metadata.socket, "getaddrinfo", resolve)
    monkeypatch.setattr(image_metadata.http.client, "HTTPConnection", Connection)
    with pytest.raises(ImageFetchError, match="private_address"):
        PublicFetcher(publisher_interval=0).get(
            "http://example.com/", 100, accepted_types=("text/html",)
        )
    assert len(connections) == 1


def test_public_fetcher_rejects_oversized_response_before_body(monkeypatch):
    from pipeline import image_metadata

    class Response:
        status = 200

        def getheader(self, name, default=None):
            return {"Content-Type": "image/png", "Content-Length": "9999"}.get(name, default)

    class Connection:
        def __init__(self, *args, **kwargs):
            pass

        def request(self, *args, **kwargs):
            pass

        def getresponse(self):
            return Response()

        def close(self):
            pass

    monkeypatch.setattr(image_metadata.socket, "getaddrinfo", lambda *a, **k: [
        (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.215.14", 80)),
    ])
    monkeypatch.setattr(image_metadata.http.client, "HTTPConnection", Connection)
    with pytest.raises(ImageFetchError, match="too_large"):
        PublicFetcher(publisher_interval=0).get(
            "http://example.com/image", 100, accepted_types=("image/png",)
        )


def test_body_deadline_survives_connection_socket_detach(monkeypatch):
    from pipeline import image_metadata

    current = [0.0]
    timeouts = []

    class Socket:
        def settimeout(self, seconds):
            timeouts.append(seconds)

    class Response:
        status = 200

        def __init__(self):
            self.reads = 0

        def getheader(self, name, default=None):
            return "text/html" if name == "Content-Type" else default

        def isclosed(self):
            return False

        def read1(self, size):
            self.reads += 1
            if self.reads == 1:
                current[0] += 2
                return b"a"
            return b""

    class Connection:
        def __init__(self, *args, **kwargs):
            self.sock = Socket()

        def request(self, *args, **kwargs):
            pass

        def getresponse(self):
            self.sock = None
            return Response()

        def close(self):
            pass

    monkeypatch.setattr(image_metadata.socket, "getaddrinfo", lambda *a, **k: [
        (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.215.14", 80)),
    ])
    monkeypatch.setattr(image_metadata.http.client, "HTTPConnection", Connection)
    PublicFetcher(timeout=5, publisher_interval=0, clock=lambda: current[0]).get(
        "http://example.com/page", 100, accepted_types=("text/html",)
    )
    assert 3 in timeouts


def test_header_drip_is_stopped_by_wall_deadline(monkeypatch):
    from pipeline import image_metadata

    stopped = threading.Event()

    class Socket:
        def settimeout(self, seconds):
            pass

        def shutdown(self, how):
            stopped.set()

        def close(self):
            pass

    class Connection:
        def __init__(self, *args, **kwargs):
            self.sock = Socket()

        def request(self, *args, **kwargs):
            pass

        def getresponse(self):
            assert stopped.wait(1)
            raise OSError("socket stopped")

        def close(self):
            pass

    monkeypatch.setattr(image_metadata.socket, "getaddrinfo", lambda *a, **k: [
        (socket.AF_INET, socket.SOCK_STREAM, 0, "", ("93.184.215.14", 80)),
    ])
    monkeypatch.setattr(image_metadata.http.client, "HTTPConnection", Connection)
    with pytest.raises(ImageFetchError, match="timeout"):
        PublicFetcher(timeout=0.05, publisher_interval=0).get(
            "http://example.com/slow", 100, accepted_types=("text/html",)
        )


@pytest.mark.parametrize("status", [403, 404])
def test_http_failure_status_stays_distinguishable_in_logs(caplog, status):
    fetcher = FakeFetcher('<meta property="og:image" content="/photo.png">', {
        "https://example.com/photo.png": ImageFetchError(f"http_{status}"),
    })
    process_image_job(job(), FakeRepository(), FakeUploader(), fetcher=fetcher)
    events = [json.loads(record.message) for record in caplog.records]
    assert any(event.get("failure_reason") == f"http_{status}" for event in events)


def test_generated_upload_failure_is_classified_as_storage_failure():
    repository = FakeRepository()
    assert process_image_job(job(article_url=None), repository, FakeUploader(fail=True)) == "failed"
    assert repository.failed[0][0][2] == "blob_upload_failed"


@pytest.mark.parametrize("committed", [False, True])
def test_uncertain_commit_never_deletes_an_upload_based_on_a_negative_read(committed):
    class UncertainRepository(FakeRepository):
        def mark_image_ready(self, *args, **kwargs):
            raise OSError("commit acknowledgement lost")

        def is_image_url_current(self, story_id, url):
            return committed

    repository, uploader = UncertainRepository(), FakeUploader()
    result = process_image_job(job(article_url=None), repository, uploader)
    assert result == ("generated" if committed else "failed")
    assert uploader.deleted == []


def test_tcp_connect_and_tls_handshake_share_timeout_budget(monkeypatch):
    from unittest.mock import Mock

    from pipeline import image_metadata

    connection = image_metadata._PinnedHTTPSConnection("publisher.test", "93.184.215.14", 443, 8)
    sock = Mock()
    context = Mock()
    context.wrap_socket.return_value = sock
    connection._context = context
    times = iter([100.0, 102.0])
    monkeypatch.setattr(image_metadata.time, "monotonic", lambda: next(times))
    monkeypatch.setattr(image_metadata.socket, "create_connection", lambda *args: sock)
    connection.connect()
    sock.settimeout.assert_called_once_with(6.0)
    context.wrap_socket.assert_called_once_with(sock, server_hostname="publisher.test")


def test_worker_settings_accept_existing_limit_names_and_bound_batch(monkeypatch):
    monkeypatch.setenv("HACKSNAP_IMAGE_TIMEOUT_SECONDS", "9")
    monkeypatch.setenv("HACKSNAP_IMAGE_HTML_MAX_BYTES", "1200000")
    monkeypatch.setenv("HACKSNAP_IMAGE_BATCH_SIZE", "11")
    monkeypatch.setenv("HACKSNAP_IMAGE_PUBLISHER_INTERVAL", "3")
    settings = ImageSettings.from_env()
    assert (settings.timeout, settings.max_html_bytes) == (9, 1_200_000)
    assert (settings.batch_size, settings.publisher_interval) == (11, 3)
    monkeypatch.setenv("HACKSNAP_IMAGE_TIMEOUT", "7")
    monkeypatch.setenv("HACKSNAP_IMAGE_MAX_HTML_BYTES", "1100000")
    settings = ImageSettings.from_env()
    assert (settings.timeout, settings.max_html_bytes) == (7, 1_100_000)
    monkeypatch.setenv("HACKSNAP_IMAGE_TIMEOUT_SECONDS", "malformed")
    monkeypatch.setenv("HACKSNAP_IMAGE_HTML_MAX_BYTES", "malformed")
    settings = ImageSettings.from_env()
    assert (settings.timeout, settings.max_html_bytes) == (7, 1_100_000)
    monkeypatch.setenv("HACKSNAP_IMAGE_BATCH_SIZE", "101")
    with pytest.raises(ValueError, match="HACKSNAP_IMAGE_BATCH_SIZE"):
        ImageSettings.from_env()


@pytest.mark.parametrize('body_size', [0, 17, 131_073])
@pytest.mark.parametrize('framing', ['length', 'chunked', 'eof'])
def test_completed_http_response_does_not_touch_closed_socket(monkeypatch, body_size, framing):
    """Exercise http.client's real EOF/socket ownership, without external network."""
    from pipeline import image_metadata

    client, server = socket.socketpair()
    body = b'x' * body_size
    headers = b'HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nConnection: close\r\n'
    if framing == 'length':
        wire = headers + f'Content-Length: {len(body)}\r\n\r\n'.encode() + body
    elif framing == 'chunked':
        chunks = [body[i:i + 4096] for i in range(0, len(body), 4096)]
        wire = headers + b'Transfer-Encoding: chunked\r\n\r\n' + b''.join(
            f'{len(chunk):x}\r\n'.encode() + chunk + b'\r\n' for chunk in chunks
        ) + b'0\r\n\r\n'
    else:
        wire = headers + b'\r\n' + body

    def serve():
        try:
            request = b''
            while b'\r\n\r\n' not in request:
                request += server.recv(4096)
            server.sendall(wire)
        finally:
            server.close()

    class Connection(http.client.HTTPConnection):
        def connect(self):
            self.sock = client

    monkeypatch.setattr(image_metadata, '_resolved_public_address', lambda *args: '93.184.215.14')
    monkeypatch.setattr(image_metadata.http.client, 'HTTPConnection', Connection)
    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    try:
        result, _, mime = PublicFetcher(timeout=5, publisher_interval=0).get(
            'http://publisher.test/image.png', max(1, len(body)), accepted_types=('image/png',),
        )
        assert result == body
        assert mime == 'image/png'
    finally:
        client.close()
        thread.join(timeout=5)
    assert not thread.is_alive()

"""Security and output checks for untrusted publisher images."""

import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO

import pytest
from PIL import Image

from pipeline.images import (
    ImageError,
    ImageLimits,
    discover_og,
    fetch_html,
    fetch_image,
    normalize_image,
)
from pipeline.images import fetch as image_fetch


def assert_reason(reason, callback):
    with pytest.raises(ImageError) as error:
        callback()
    assert error.value.reason == reason


def test_og_candidates_are_resolved_and_ordered():
    html = """<meta property="og:image:secure_url" content="//cdn.example/photo-2.png">
    <meta name="OG:IMAGE" content="/photo-1.jpg">
    <meta property="og:image:url" content="../photo-3.webp">
    <meta property="og:image" content="/photo-1.jpg">"""
    assert discover_og(html, "https://example.com/posts/123") == [
        "https://example.com/photo-1.jpg",
        "https://cdn.example/photo-2.png",
        "https://example.com/photo-3.webp",
    ]
    assert_reason("no_image_metadata", lambda: discover_og("<html></html>", "https://example.com"))


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/p", "http://10.0.0.1/p", "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/", "http://[fe80::1]/", "http://[::ffff:127.0.0.1]/",
    "http://[2002:c0a8:101::]/", "http://[64:ff9b::a00:1]/", "http://224.0.0.1/",
    "file:///etc/passwd", "http://user:pass@example.com/", "http://example.com\\@127.0.0.1/",
    "http://example.com:0/",
])
def test_blocked_urls_never_start_request(url):
    assert_reason("blocked_url", lambda: fetch_image(url))


def test_mixed_dns_answer_is_rejected(monkeypatch):
    def addresses(*_args, **_kwargs):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("8.8.8.8", 80)),
            (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("10.0.0.1", 80)),
        ]

    monkeypatch.setattr(image_fetch.socket, "getaddrinfo", addresses)
    assert_reason("blocked_url", lambda: fetch_image("http://example.com/a"))


@pytest.fixture
def publisher(monkeypatch):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append((self.path, self.headers.get("Host")))
            if self.path == "/redirect":
                self.send_response(302)
                self.send_header("Location", "/image")
                self.end_headers()
                return
            if self.path == "/private-redirect":
                self.send_response(302)
                self.send_header("Location", "http://127.0.0.1/secret")
                self.end_headers()
                return
            if self.path == "/many":
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.end_headers()
                self.wfile.write(b"a" * 64)
                return
            if self.path == "/loop":
                self.send_response(302)
                self.send_header("Location", "/loop")
                self.end_headers()
                return
            if self.path == "/html":
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(b'<meta property="og:image" content="/image">')
                return
            if self.path == "/slow":
                time.sleep(0.2)
            if self.path == "/trickle-headers":
                try:
                    self.wfile.write(b"HTTP/1.1 200 OK\r\n")
                    for _ in range(20):
                        self.wfile.write(b"X-Test: a\r\n")
                        self.wfile.flush()
                        time.sleep(0.02)
                    self.wfile.write(b"Content-Type: image/png\r\n\r\n")
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            if self.path == "/trickle-body":
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.end_headers()
                try:
                    for _ in range(20):
                        self.wfile.write(b"a")
                        self.wfile.flush()
                        time.sleep(0.02)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return
            if self.path == "/forbidden":
                self.send_response(403)
                self.end_headers()
                return
            if self.path == "/missing":
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/png" if self.path != "/wrong" else "text/plain")
            self.end_headers()
            try:
                self.wfile.write(b"image")
            except BrokenPipeError:
                pass

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    # A real socket still connects, but to the pinned address returned by the resolver.
    def pinned(_host, _port, _deadline):
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "",
                 ("127.0.0.1", server.server_port))]

    monkeypatch.setattr(image_fetch, "_resolve_addresses", pinned)
    try:
        yield server, requests
    finally:
        server.shutdown()
        server.server_close()


def test_pinned_destination_redirects_callback_and_mime(publisher):
    server, requests = publisher
    origin = f"http://example.com:{server.server_port}"
    seen = []
    assert fetch_image(origin + "/redirect", before_request=seen.append) == b"image"
    assert seen == [origin + "/redirect", origin + "/image"]
    assert requests == [("/redirect", f"example.com:{server.server_port}"),
                        ("/image", f"example.com:{server.server_port}")]
    assert "og:image" in fetch_html(origin + "/html")
    assert_reason("invalid_content_type", lambda: fetch_image(origin + "/wrong"))
    assert_reason("http_403", lambda: fetch_image(origin + "/forbidden"))
    assert_reason("http_404", lambda: fetch_image(origin + "/missing"))
    assert_reason("fetch_failed", lambda: fetch_image(
        origin + "/loop", ImageLimits(max_redirects=2),
    ))


def test_redirect_to_private_address_is_blocked_before_request(publisher):
    server, requests = publisher
    seen = []
    assert_reason("blocked_url", lambda: fetch_image(
        f"http://example.com:{server.server_port}/private-redirect", before_request=seen.append,
    ))
    assert len(requests) == len(seen) == 1


def test_rate_limiter_runs_for_each_connection_attempt(publisher, monkeypatch):
    server, _ = publisher
    origin = f"http://example.com:{server.server_port}"
    monkeypatch.setattr(image_fetch, "_resolve_addresses", lambda *_: [
        (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("127.0.0.1", 0)),
        (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "",
         ("127.0.0.1", server.server_port)),
    ])
    seen = []
    assert fetch_image(origin + "/image", before_request=seen.append) == b"image"
    assert seen == [origin + "/image", origin + "/image"]


def test_streaming_cap_and_timeout(publisher):
    server, _ = publisher
    origin = f"http://example.com:{server.server_port}"
    limits = ImageLimits(max_image_bytes=32)
    assert_reason("image_too_large", lambda: fetch_image(origin + "/many", limits))
    assert_reason("image_too_large", lambda: fetch_html(
        origin + "/html", ImageLimits(max_html_bytes=16),
    ))
    assert_reason("fetch_timeout", lambda: fetch_image(
        origin + "/slow", ImageLimits(timeout_seconds=0.05),
    ))
    for path in ("/trickle-headers", "/trickle-body"):
        assert_reason("fetch_timeout", lambda path=path: fetch_image(
            origin + path, ImageLimits(timeout_seconds=0.1),
        ))


def make_image(size=(2400, 1200), mode="RGB"):
    buffer = BytesIO()
    Image.effect_mandelbrot(size, (-2, -1, 1, 1), 32).convert(mode).save(buffer, "PNG")
    return buffer.getvalue()


def test_normalization_bounds_and_strips_metadata():
    raw = BytesIO()
    raw.write(make_image())
    output, width, height = normalize_image(raw.getvalue())
    assert (width, height) == (1600, 800)
    with Image.open(BytesIO(output)) as image:
        assert image.format == "WEBP"
        assert image.size == (1600, 800)
        assert not image.getexif()
    assert_reason("image_too_small", lambda: normalize_image(make_image((599, 300))))
    assert_reason("image_too_large", lambda: normalize_image(
        make_image(), ImageLimits(max_pixels=1_000_000),
    ))
    assert_reason("decode_failed", lambda: normalize_image(b"not an image"))


def test_orientation_and_exif_are_applied_then_removed():
    source = Image.effect_mandelbrot((300, 600), (-2, -1, 1, 1), 32).convert("RGB")
    exif = Image.Exif()
    exif[274] = 6  # Rotate the portrait into a 600x300 landscape image.
    exif[315] = "Publisher"
    raw = BytesIO()
    source.save(raw, "JPEG", exif=exif)
    output, width, height = normalize_image(raw.getvalue())
    assert (width, height) == (600, 300)
    with Image.open(BytesIO(output)) as image:
        assert image.getexif().get(315) is None

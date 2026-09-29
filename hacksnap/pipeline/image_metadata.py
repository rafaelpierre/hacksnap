"""Bounded public-network fetches and publisher image metadata extraction."""

from __future__ import annotations

import http.client
import ipaddress
import json
import queue
import socket
import ssl
import threading
import time
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit


class ImageFetchError(ValueError):
    """Controlled reason safe to include in structured logs."""


@dataclass(frozen=True)
class ImageCandidate:
    url: str
    source_type: str


def safe_url(url: str | None) -> str:
    """Strip secrets in query strings, fragments and user info from diagnostics."""
    try:
        parsed = urlsplit(url or "")
        host = parsed.hostname or ""
        if parsed.port:
            host += f":{parsed.port}"
        return urlunsplit((parsed.scheme, host, parsed.path, "", ""))
    except ValueError:
        return "[invalid URL]"


def _public_address(value: str) -> bool:
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    if isinstance(ip, ipaddress.IPv6Address):
        tunnel_prefixes = ("2002::/16", "2001::/32", "64:ff9b::/96", "64:ff9b:1::/48")
        if any(ip in ipaddress.ip_network(prefix) for prefix in tunnel_prefixes):
            return False
    return ip.is_global and not ip.is_multicast and not ip.is_reserved


def public_url(url: str) -> tuple[str, str, int, str]:
    """Validate a URL before any DNS lookup or connection."""
    if not isinstance(url, str) or any(ord(char) < 33 or ord(char) == 127 for char in url):
        raise ImageFetchError("invalid_url")
    if "\\" in url:
        raise ImageFetchError("invalid_url")
    try:
        parsed = urlsplit(url)
        host = parsed.hostname
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
    except ValueError as exc:
        raise ImageFetchError("invalid_url") from exc
    if (
        parsed.scheme not in {"http", "https"} or not host or parsed.username
        or parsed.password or port not in {80, 443} or len(url) > 4096
    ):
        raise ImageFetchError("invalid_url")
    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ImageFetchError("invalid_url") from exc
    if host.endswith((".local", ".internal")) or host == "localhost":
        raise ImageFetchError("private_address")
    if "%" in host:
        raise ImageFetchError("invalid_url")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        if not _public_address(host):
            raise ImageFetchError("private_address")
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query
    return parsed.scheme, host, port, path


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Connect to the DNS-checked IP while verifying TLS for the original host."""

    def __init__(self, hostname: str, address: str, port: int, timeout: float):
        super().__init__(hostname, port, timeout=timeout, context=ssl.create_default_context())
        self._address = address

    def connect(self) -> None:
        started = time.monotonic()
        self.sock = socket.create_connection((self._address, self.port), self.timeout)
        remaining = self.timeout - (time.monotonic() - started)
        if remaining <= 0:
            self.sock.close()
            raise TimeoutError("Image connection deadline expired")
        # TCP connect and the TLS handshake share the same remaining budget.
        self.sock.settimeout(remaining)
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)


def _expire_socket(sock: socket.socket, event: threading.Event) -> None:
    event.set()
    try:
        sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass
    sock.close()


def _resolved_public_address(host: str, port: int, remaining: float) -> str:
    results_queue: queue.Queue[object] = queue.Queue(maxsize=1)

    def resolve() -> None:
        try:
            results_queue.put(socket.getaddrinfo(host, port, type=socket.SOCK_STREAM))
        except OSError as exc:
            results_queue.put(exc)

    threading.Thread(target=resolve, daemon=True).start()
    try:
        results = results_queue.get(timeout=remaining)
    except queue.Empty as exc:
        raise ImageFetchError("timeout") from exc
    if isinstance(results, OSError):
        exc = results
        raise ImageFetchError("dns_failure") from exc
    if not results:
        raise ImageFetchError("dns_failure")
    addresses = [entry[4][0] for entry in results]
    if not all(_public_address(address) for address in addresses):
        raise ImageFetchError("private_address")
    return addresses[0]


class PublicFetcher:
    """Fetch HTTP(S) without proxies, with pinned DNS and a total deadline."""

    def __init__(
        self, timeout: float = 8, max_redirects: int = 3, *, publisher_interval: float = 1.0,
        clock=time.monotonic, sleep=time.sleep,
    ):
        if not 0 <= publisher_interval <= 10:
            raise ValueError("publisher_interval must be between 0 and 10")
        self.timeout = timeout
        self.max_redirects = max_redirects
        self.publisher_interval = publisher_interval
        self._clock = clock
        self._sleep = sleep
        self._next_request: dict[str, float] = {}

    def _pace(self, host: str) -> float:
        wait = max(0.0, self._next_request.get(host, 0.0) - self._clock())
        if wait:
            self._sleep(wait)
        self._next_request[host] = self._clock() + self.publisher_interval
        return wait

    def get(self, url: str, max_bytes: int, *, accepted_types: tuple[str, ...]) -> tuple[bytes, str, str]:
        deadline = self._clock() + self.timeout
        visited: set[str] = set()
        for _ in range(self.max_redirects + 1):
            scheme, host, port, path = public_url(url)
            if url in visited:
                raise ImageFetchError("redirect_loop")
            visited.add(url)
            # Courtesy pacing is bounded separately from active network time.
            deadline += self._pace(host)
            remaining = deadline - self._clock()
            if remaining <= 0:
                raise ImageFetchError("timeout")
            address = _resolved_public_address(host, port, remaining)
            remaining = deadline - self._clock()
            if remaining <= 0:
                raise ImageFetchError("timeout")
            connection = (
                _PinnedHTTPSConnection(host, address, port, remaining)
                if scheme == "https" else http.client.HTTPConnection(address, port, timeout=remaining)
            )
            watchdog: threading.Timer | None = None
            expired = threading.Event()
            try:
                host_header = f"[{host}]" if ":" in host else host
                connection.request(
                    "GET", path,
                    headers={"Host": host_header, "User-Agent": "HacksnapImageBot/1.0",
                             "Accept-Encoding": "identity", "Connection": "close"},
                )
                # http.client may detach the socket for Connection: close, so
                # retain it before getresponse() for per-chunk deadline updates.
                active_socket = getattr(connection, "sock", None)
                if active_socket is not None:
                    active_socket.settimeout(max(0.001, deadline - self._clock()))
                    watchdog = threading.Timer(
                        max(0.001, deadline - self._clock()),
                        _expire_socket,
                        args=(active_socket, expired),
                    )
                    watchdog.daemon = True
                    watchdog.start()
                response = connection.getresponse()
                if response.status in {301, 302, 303, 307, 308}:
                    location = response.getheader("Location")
                    if not location:
                        raise ImageFetchError("redirect_without_location")
                    url = urljoin(url, location)
                    continue
                if response.status != 200:
                    raise ImageFetchError(f"http_{response.status}")
                media_type = (response.getheader("Content-Type") or "").split(";", 1)[0].strip().lower()
                if media_type not in accepted_types:
                    raise ImageFetchError("unsupported_mime")
                if response.getheader("Content-Encoding", "identity").lower() != "identity":
                    raise ImageFetchError("unsupported_encoding")
                content_length = response.getheader("Content-Length")
                if content_length:
                    try:
                        declared_length = int(content_length)
                    except ValueError as exc:
                        raise ImageFetchError("invalid_content_length") from exc
                    if declared_length > max_bytes:
                        raise ImageFetchError("too_large")
                chunks: list[bytes] = []
                size = 0
                # A final Content-Length read closes HTTPResponse's file and,
                # with Connection: close, the retained socket too. Stop before
                # attempting another timeout update on that closed descriptor.
                while not response.isclosed():
                    remaining = deadline - self._clock()
                    if remaining <= 0:
                        raise ImageFetchError("timeout")
                    if active_socket is not None:
                        active_socket.settimeout(remaining)
                    chunk = response.read1(min(65536, max_bytes + 1 - size))
                    if not chunk:
                        break
                    chunks.append(chunk)
                    size += len(chunk)
                    if size > max_bytes:
                        raise ImageFetchError("too_large")
                return b"".join(chunks), url, media_type
            except TimeoutError as exc:
                raise ImageFetchError("timeout") from exc
            except (OSError, ssl.SSLError, http.client.HTTPException, UnicodeError) as exc:
                if expired.is_set():
                    raise ImageFetchError("timeout") from exc
                raise ImageFetchError("network_error") from exc
            finally:
                if watchdog is not None:
                    watchdog.cancel()
                connection.close()
        raise ImageFetchError("too_many_redirects")


def _image_values(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [item for member in value for item in _image_values(member)]
    if isinstance(value, dict):
        return _image_values(value.get("url") or value.get("contentUrl") or value.get("@id"))
    return []


def _jsonld_images(node: object) -> list[str]:
    if isinstance(node, list):
        return [image for member in node for image in _jsonld_images(member)]
    if not isinstance(node, dict):
        return []
    result = _image_values(node.get("image")) if "image" in node else []
    for key in ("@graph", "mainEntity", "mainEntityOfPage"):
        if key in node:
            result.extend(_jsonld_images(node[key]))
    return result


class _MetadataParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta: list[tuple[str, str]] = []
        self.jsonld: list[str] = []
        self.base: str | None = None
        self._in_jsonld = False
        self._jsonld_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): value for key, value in attrs if value}
        if tag == "base" and self.base is None:
            self.base = values.get("href")
        if tag == "meta":
            key = (values.get("property") or values.get("name") or "").lower()
            if key and values.get("content"):
                self.meta.append((key, values["content"]))
        if tag == "script" and values.get("type", "").lower() == "application/ld+json":
            self._in_jsonld = True
            self._jsonld_parts = []

    def handle_data(self, data: str) -> None:
        if self._in_jsonld:
            self._jsonld_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self._in_jsonld:
            self.jsonld.append("".join(self._jsonld_parts))
            self._in_jsonld = False


def extract_candidates(html: str, page_url: str) -> list[ImageCandidate]:
    """Order OG, Twitter and JSON-LD images, resolving and deduplicating URLs."""
    parser = _MetadataParser()
    parser.feed(html)
    base = urljoin(page_url, parser.base) if parser.base else page_url
    candidates: list[ImageCandidate] = []
    seen: set[str] = set()

    def add(raw: str, source_type: str) -> None:
        url = urljoin(base, raw.strip())
        try:
            public_url(url)
        except ImageFetchError:
            return
        if url not in seen:
            seen.add(url)
            candidates.append(ImageCandidate(url, source_type))

    for keys, source_type in (
        ({"og:image", "og:image:url", "og:image:secure_url"}, "og"),
        ({"twitter:image", "twitter:image:src"}, "twitter"),
    ):
        for key, raw in parser.meta:
            if key in keys:
                add(raw, source_type)
    for raw_script in parser.jsonld:
        try:
            data = json.loads(raw_script)
        except (ValueError, TypeError):
            continue
        for raw in _jsonld_images(data):
            add(raw, "json_ld")
    return candidates[:20]

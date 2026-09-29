"""Fetch untrusted publisher pages and images without allowing private-network access."""

import http.client
import ipaddress
import queue
import socket
import ssl
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from urllib.parse import SplitResult, urljoin, urlsplit


@dataclass(frozen=True, slots=True)
class ImageLimits:
    max_image_bytes: int = 10_000_000
    max_html_bytes: int = 2_000_000
    max_pixels: int = 40_000_000
    min_width: int = 600
    min_height: int = 300
    max_dimension: int = 1600
    timeout_seconds: float = 10.0
    max_redirects: int = 5


DEFAULT_LIMITS = ImageLimits()


class _DeadlineWatchdog:
    """Interrupt a stalled socket even when a peer keeps sending tiny fragments."""

    def __init__(self, deadline: float):
        self._lock = threading.Lock()
        self._socket: socket.socket | None = None
        self.expired = False
        self._timer = threading.Timer(max(0, deadline - time.monotonic()), self._expire)
        self._timer.daemon = True
        self._timer.start()

    def attach(self, sock: socket.socket) -> None:
        with self._lock:
            if self.expired:
                sock.close()
                raise ImageError("fetch_timeout")
            self._socket = sock

    def _expire(self) -> None:
        with self._lock:
            self.expired = True
            sock = self._socket
            self._socket = None
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()

    def close(self) -> None:
        self._timer.cancel()
        with self._lock:
            self._socket = None


class ImageError(Exception):
    """A controlled failure whose reason is safe to persist or count."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


def _remaining(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise ImageError("fetch_timeout")
    return remaining


def _parse_url(url: str) -> tuple[SplitResult, str, int]:
    if not isinstance(url, str) or any(ord(char) < 33 or ord(char) == 127 for char in url):
        raise ImageError("blocked_url")
    # Backslashes have different interpretations across URL parsers and servers.
    if "\\" in url:
        raise ImageError("blocked_url")
    try:
        parts = urlsplit(url)
        if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
            raise ImageError("blocked_url")
        if parts.username is not None or parts.password is not None:
            raise ImageError("blocked_url")
        host = parts.hostname
        if "%" in host:  # IPv6 zone identifiers are local-interface selectors.
            raise ImageError("blocked_url")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            if not _is_public(host):
                raise ImageError("blocked_url")
        port = parts.port if parts.port is not None else (443 if parts.scheme.lower() == "https" else 80)
        if port < 1 or port > 65535:
            raise ImageError("blocked_url")
        return parts, host, port
    except ValueError as exc:
        raise ImageError("blocked_url") from exc


def _is_public(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    if isinstance(ip, ipaddress.IPv6Address):
        # These tunnel prefixes can carry an embedded private IPv4 destination.
        unsafe_prefixes = ("2002::/16", "2001::/32", "64:ff9b::/96", "64:ff9b:1::/48")
        if any(ip in ipaddress.ip_network(prefix) for prefix in unsafe_prefixes):
            return False
    return (ip.is_global and not ip.is_multicast and not ip.is_reserved
            and not ip.is_unspecified and not ip.is_link_local and not ip.is_loopback)


def _resolve_addresses(host: str, port: int, deadline: float) -> list[tuple]:
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None:
        if not _is_public(host):
            raise ImageError("blocked_url")
        if isinstance(literal, ipaddress.IPv4Address):
            return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (host, port))]
        return [(socket.AF_INET6, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (host, port, 0, 0))]

    results: queue.Queue[tuple[list[tuple] | None, OSError | UnicodeError | None]] = queue.Queue(maxsize=1)

    def resolve() -> None:
        try:
            answer = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM,
                                        proto=socket.IPPROTO_TCP)
            results.put((answer, None))
        except (OSError, UnicodeError) as exc:
            results.put((None, exc))

    threading.Thread(target=resolve, daemon=True).start()
    try:
        addresses, error = results.get(timeout=_remaining(deadline))
    except queue.Empty as exc:
        raise ImageError("fetch_timeout") from exc
    if error or not addresses:
        raise ImageError("fetch_failed") from error
    # Reject a mixed answer, too: the transport must never have an unchecked fallback.
    if any(not _is_public(item[4][0]) for item in addresses):
        raise ImageError("blocked_url")
    return addresses


class _PinnedConnection:
    address: tuple
    deadline: float
    watchdog: _DeadlineWatchdog

    def _dial(self) -> socket.socket:
        family, socktype, proto, _, sockaddr = self.address
        sock = socket.socket(family, socktype, proto)
        try:
            self.watchdog.attach(sock)
            sock.settimeout(_remaining(self.deadline))
            sock.connect(sockaddr)
            return sock
        except BaseException:
            sock.close()
            raise


class _PinnedHTTPConnection(_PinnedConnection, http.client.HTTPConnection):
    def __init__(self, host: str, port: int, address: tuple, deadline: float,
                 watchdog: _DeadlineWatchdog):
        super().__init__(host, port, timeout=_remaining(deadline))
        self.address = address
        self.deadline = deadline
        self.watchdog = watchdog
        self.pinned_socket: socket.socket | None = None

    def connect(self) -> None:
        self.sock = self._dial()
        self.pinned_socket = self.sock


class _PinnedHTTPSConnection(_PinnedConnection, http.client.HTTPSConnection):
    def __init__(self, host: str, port: int, address: tuple, deadline: float,
                 watchdog: _DeadlineWatchdog):
        super().__init__(host, port, timeout=_remaining(deadline), context=ssl.create_default_context())
        self.address = address
        self.deadline = deadline
        self.watchdog = watchdog
        self.pinned_socket: socket.socket | None = None

    def connect(self) -> None:
        sock = self._dial()
        try:
            sock.settimeout(_remaining(self.deadline))
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
            self.watchdog.attach(self.sock)
            self.pinned_socket = self.sock
        except BaseException:
            sock.close()
            raise


def _read_body(response: http.client.HTTPResponse, connection: _PinnedConnection,
               max_bytes: int, deadline: float) -> bytes:
    declared = response.getheader("content-length")
    try:
        if declared is not None and int(declared) > max_bytes:
            raise ImageError("image_too_large")
    except ValueError:
        pass
    chunks: list[bytes] = []
    total = 0
    while True:
        sock = connection.pinned_socket
        if sock is not None:
            sock.settimeout(_remaining(deadline))
        chunk = response.read1(min(65_536, max_bytes + 1 - total))
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise ImageError("image_too_large")
        chunks.append(chunk)
    _remaining(deadline)
    return b"".join(chunks)


def _fetch(url: str, *, kind: str, limits: ImageLimits,
           before_request: Callable[[str], None] | None) -> tuple[bytes, str]:
    deadline = time.monotonic() + limits.timeout_seconds
    watchdog = _DeadlineWatchdog(deadline)
    try:
        return _fetch_with_deadline(url, kind=kind, limits=limits,
                                    before_request=before_request, deadline=deadline,
                                    watchdog=watchdog)
    finally:
        watchdog.close()


def _fetch_with_deadline(url: str, *, kind: str, limits: ImageLimits,
                         before_request: Callable[[str], None] | None, deadline: float,
                         watchdog: _DeadlineWatchdog) -> tuple[bytes, str]:
    current = url
    for redirect_count in range(limits.max_redirects + 1):
        parts, host, port = _parse_url(current)
        addresses = _resolve_addresses(host, port, deadline)
        connection: _PinnedHTTPConnection | _PinnedHTTPSConnection | None = None
        try:
            for address in addresses:
                try:
                    if before_request is not None:
                        before_request(current)
                    _remaining(deadline)
                    connection = (_PinnedHTTPSConnection(host, port, address, deadline, watchdog)
                                  if parts.scheme.lower() == "https"
                                  else _PinnedHTTPConnection(host, port, address, deadline, watchdog))
                    target = parts.path or "/"
                    if parts.query:
                        target += "?" + parts.query
                    connection.request("GET", target, headers={
                        "User-Agent": "HacksnapImageBot/1.0",
                        "Accept": "text/html,application/xhtml+xml" if kind == "html" else "image/*",
                        "Accept-Encoding": "identity",
                    })
                    if connection.pinned_socket is not None:
                        connection.pinned_socket.settimeout(_remaining(deadline))
                    response = connection.getresponse()
                    _remaining(deadline)
                    break
                except TimeoutError as exc:
                    if connection is not None:
                        connection.close()
                    raise ImageError("fetch_timeout") from exc
                except (OSError, ssl.SSLError, http.client.HTTPException):
                    if connection is not None:
                        connection.close()
                    connection = None
                    if watchdog.expired:
                        raise ImageError("fetch_timeout") from None
                    _remaining(deadline)
            else:
                raise ImageError("fetch_failed")

            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader("location")
                if not location or redirect_count >= limits.max_redirects:
                    raise ImageError("fetch_failed")
                current = urljoin(current, location)
                # Validate redirect syntax immediately; DNS is checked on the next loop.
                _parse_url(current)
                continue
            if not 200 <= response.status < 300:
                reason = f"http_{response.status}" if response.status in (403, 404) else "fetch_failed"
                raise ImageError(reason)
            media_type = (response.getheader("content-type") or "").split(";", 1)[0].lower().strip()
            if kind == "image" and not media_type.startswith("image/"):
                raise ImageError("invalid_content_type")
            if kind == "html" and media_type not in ("text/html", "application/xhtml+xml"):
                raise ImageError("invalid_content_type")
            limit = limits.max_html_bytes if kind == "html" else limits.max_image_bytes
            return _read_body(response, connection, limit, deadline), response.getheader("content-type") or ""
        except ImageError:
            raise
        except TimeoutError as exc:
            raise ImageError("fetch_timeout") from exc
        except (OSError, ssl.SSLError, http.client.HTTPException) as exc:
            raise ImageError("fetch_timeout" if watchdog.expired else "fetch_failed") from exc
        finally:
            if connection is not None:
                connection.close()
    raise ImageError("fetch_failed")


def fetch_html(url: str, limits: ImageLimits = DEFAULT_LIMITS, *,
               before_request: Callable[[str], None] | None = None) -> str:
    """Fetch a bounded HTML page through a checked, pinned destination."""
    body, content_type = _fetch(url, kind="html", limits=limits, before_request=before_request)
    charset = "utf-8"
    for parameter in content_type.split(";")[1:]:
        if parameter.strip().lower().startswith("charset="):
            charset = parameter.split("=", 1)[1].strip().strip('"')
            break
    try:
        return body.decode(charset, errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


def fetch_image(url: str, limits: ImageLimits = DEFAULT_LIMITS, *,
                before_request: Callable[[str], None] | None = None) -> bytes:
    """Fetch at most ten megabytes of image data through a pinned destination."""
    body, _ = _fetch(url, kind="image", limits=limits, before_request=before_request)
    return body

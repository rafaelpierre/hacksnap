"""CLI contract verified against the published kestrel-rs 10.1.0 crate."""

import json
import subprocess
from urllib.parse import urlsplit

from .preprocess import normalize


class FetchError(RuntimeError):
    pass


class FetcherUnavailableError(RuntimeError):
    """A worker configuration problem, not a failure of an individual article."""


def external_article_url(url: str | None) -> str | None:
    if not url:
        return None
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    if parsed.hostname.lower() in {"news.ycombinator.com", "www.news.ycombinator.com"}:
        return None
    if parsed.username or parsed.password:
        return None
    return url


class KestrelFetcher:
    def __init__(self, binary: str, timeout: int = 30, content_limit: int = 24000):
        self.binary, self.timeout, self.content_limit = binary, timeout, content_limit

    def fetch(self, url: str) -> str:
        try:
            result = subprocess.run(
                [
                    self.binary,
                    "fetch",
                    url,
                    "--output",
                    "json",
                    "--timeout",
                    str(self.timeout),
                    "--content-limit",
                    str(self.content_limit),
                    "--max-response-bytes",
                    "2000000",
                ],
                capture_output=True,
                text=True,
                timeout=self.timeout + 5,
                check=False,
            )
        except subprocess.TimeoutExpired:
            raise FetchError("Kestrel timed out") from None
        except OSError:
            raise FetcherUnavailableError("Kestrel executable unavailable") from None
        if result.returncode:
            # Do not echo arbitrary subprocess output or URL query credentials into logs.
            raise FetchError(f"Kestrel exited with code {result.returncode}")
        try:
            content = json.loads(result.stdout)["content"]
            if not isinstance(content, str):
                raise TypeError
            prefix = f"Source: {url}\n\n"
            content = normalize(content.removeprefix(prefix))[: self.content_limit]
            if not content:
                raise ValueError
            return content
        except (ValueError, KeyError, TypeError):
            raise FetchError("Kestrel returned no valid article content") from None

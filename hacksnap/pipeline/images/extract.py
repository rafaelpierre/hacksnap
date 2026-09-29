"""Discover publisher-provided Open Graph images without fetching page resources."""

from html.parser import HTMLParser
from urllib.parse import urljoin

from .fetch import ImageError


class _OpenGraphParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.images: dict[str, list[str]] = {
            "og:image": [],
            "og:image:secure_url": [],
            "og:image:url": [],
        }

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "meta":
            return
        attributes = {key.lower(): value for key, value in attrs if value is not None}
        name = (attributes.get("property") or attributes.get("name") or "").lower()
        content = (attributes.get("content") or "").strip()
        if name in self.images and content:
            self.images[name].append(content)


def discover_og(html: str, article_url: str) -> list[str]:
    """Return distinct OG candidates, preferring og:image over its URL variants."""
    parser = _OpenGraphParser()
    parser.feed(html)
    candidates: list[str] = []
    seen: set[str] = set()
    for name in ("og:image", "og:image:secure_url", "og:image:url"):
        for value in parser.images[name]:
            try:
                resolved = urljoin(article_url, value)
            except ValueError as error:
                raise ImageError("blocked_url") from error
            if resolved not in seen:
                seen.add(resolved)
                candidates.append(resolved)
    if not candidates:
        raise ImageError("no_image_metadata")
    return candidates

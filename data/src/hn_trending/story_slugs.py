"""Stable public story slugs, assigned only when a story is first inserted."""
import re
import unicodedata


def story_slug(story_id: int, title: str) -> str:
    normalized = unicodedata.normalize("NFKD", title)
    headline = "".join(c for c in normalized if not unicodedata.category(c).startswith("M"))
    headline = headline.lower().replace("’", "").replace("'", "")
    headline = re.sub(r"[^a-z0-9]+", "-", headline).strip("-")[:80].rstrip("-")
    return f"{headline or 'story'}-{story_id}"

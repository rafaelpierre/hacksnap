"""Deterministic, bounded source preparation without another HN request."""

import hashlib
import json
import re
from html.parser import HTMLParser


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


class TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.hidden = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.hidden += 1
        if tag in {"p", "br", "li", "div", "pre"}:
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if tag in {"script", "style"}:
            self.hidden = max(0, self.hidden - 1)
        if tag in {"p", "li", "div", "pre"}:
            self.parts.append(" ")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def plain_text(html: str) -> str:
    parser = TextExtractor()
    parser.feed(html)
    return normalize("".join(parser.parts))


def prepare_comments(payload: dict, budget: int = 48000) -> tuple[list[dict], dict]:
    candidates = {}
    for entry in payload.get("comments", []):
        item = entry.get("item", {})
        if item.get("deleted") or item.get("dead"):
            continue
        text = plain_text(item.get("text") or "")
        if not text or not isinstance(item.get("id"), int):
            continue
        candidates[item["id"]] = {
            "id": item["id"],
            "parent": item.get("parent"),
            "author": item.get("by", "unknown"),
            "depth": entry.get("depth", 1),
            "text": text,
        }
    # Prefer active branches; include available ancestors before a selected reply.
    descendants = dict.fromkeys(candidates, 0)
    for comment in candidates.values():
        parent = comment["parent"]
        seen = {comment["id"]}
        while parent in candidates and parent not in seen:
            seen.add(parent)
            descendants[parent] += 1
            parent = candidates[parent]["parent"]
    ordered = sorted(
        candidates.values(),
        key=lambda c: (
            -descendants[c["id"]],
            c["depth"],
            -min(len(c["text"]), 2000),
            c["id"],
        ),
    )
    selected = {}
    used = 2  # JSON list brackets
    for comment in ordered:
        chain = [comment]
        seen = {comment["id"]}
        parent = comment["parent"]
        while parent in candidates and parent not in seen and parent not in selected:
            chain.append(candidates[parent])
            seen.add(parent)
            parent = candidates[parent]["parent"]
        chain = [c for c in reversed(chain) if c["id"] not in selected]
        cost = sum(len(json.dumps(c, ensure_ascii=False)) + 2 for c in chain)
        if used + cost <= budget:
            selected.update((c["id"], c) for c in chain)
            used += cost
    comments = sorted(selected.values(), key=lambda c: (c["depth"], c["id"]))
    return comments, {
        "stored_comments": len(candidates),
        "included_comments": len(comments),
        "comments_truncated": len(comments) < len(candidates),
    }


def sample_sentiment_comments(comments: list[dict]) -> list[dict]:
    """Stable pseudorandom sample, independent of input order or Python hash seeds."""
    selected = sorted(
        comments,
        key=lambda comment: hashlib.sha256(str(comment["id"]).encode()).digest(),
    )[:10]
    return sorted(selected, key=lambda comment: (comment["depth"], comment["id"]))


def source_fingerprint(source: dict, model: str, prompt_version: str) -> str:
    encoded = json.dumps(
        {"source": source, "model": model, "prompt_version": prompt_version},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(encoded.encode()).hexdigest()

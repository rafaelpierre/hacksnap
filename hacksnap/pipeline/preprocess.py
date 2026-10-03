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


DEFAULT_COMMENT_CHARS = 12000
MAX_DISCUSSION_THREADS = 4


def prepare_comments(
    payload: dict, budget: int = DEFAULT_COMMENT_CHARS
) -> tuple[list[dict], dict]:
    """Sample four active retained threads, counting the complete JSON list cost.

    Keep removed nodes for ancestry/activity only. Never promote an orphan reply
    to a root. Omit whole comments when they cannot fit, including replies whose
    usable ancestors cannot fit; cutting text could remove a material caveat.
    """
    if budget < 2:
        raise ValueError("Comment budget must fit an empty JSON list (at least 2 characters)")
    nodes = {
        entry["item"]["id"]: entry
        for entry in payload.get("comments", [])
        if isinstance(entry.get("item", {}).get("id"), int)
    }
    candidates = {}
    for cid, entry in nodes.items():
        item = entry["item"]
        if item.get("deleted") or item.get("dead"):
            continue
        text = plain_text(item.get("text") or "")
        if text:
            candidates[cid] = {
                "id": cid,
                "parent": item.get("parent"),
                "author": item.get("by", "unknown"),
                "depth": entry.get("depth", 1),
                "text": text,
            }

    # Resolve ancestry through all retained nodes, including removed parents.
    # The story parent is authoritative; depth is a fallback for legacy payloads.
    story_id = payload.get("story", {}).get("id")
    chains = {}
    descendants = dict.fromkeys(nodes, 0)
    for cid in nodes:
        chain, seen = [], set()
        current = cid
        while current in nodes and current not in seen:
            seen.add(current)
            chain.append(current)
            entry = nodes[current]
            parent = entry["item"].get("parent")
            is_root = (parent == story_id if story_id is not None else
                       entry.get("depth", 1) == 1 and parent not in nodes)
            if is_root:
                chains[cid] = list(reversed(chain))
                for ancestor in chain[1:]:
                    descendants[ancestor] += 1
                break
            current = parent

    roots = sorted(
        {chains[cid][0] for cid in candidates if cid in chains},
        key=lambda cid: (-descendants[cid], cid),
    )[:MAX_DISCUSSION_THREADS]
    root_order = {cid: index for index, cid in enumerate(roots)}
    eligible = [cid for cid in candidates if cid in chains and chains[cid][0] in root_order]
    # Reserve root context first, then prefer replies with active subbranches.
    ordered = sorted(eligible, key=lambda cid: (
        0 if cid in root_order else 1,
        -descendants[cid], root_order[chains[cid][0]], len(chains[cid]), cid,
    ))
    selected = {}
    used = 2  # JSON list brackets, including the empty-input case.
    for cid in ordered:
        chain = [candidates[ancestor] for ancestor in chains[cid]
                 if ancestor in candidates and ancestor not in selected]
        cost = sum(len(json.dumps(comment, ensure_ascii=False)) for comment in chain)
        cost += 2 * (len(chain) if selected else max(0, len(chain) - 1))
        if used + cost <= budget:
            selected.update((comment["id"], comment) for comment in chain)
            used += cost
    comments = sorted(selected.values(), key=lambda comment: (
        root_order[chains[comment["id"]][0]], len(chains[comment["id"]]), comment["id"],
    ))
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

"""Client for the official Hacker News Firebase API."""

from __future__ import annotations

from collections import deque
from collections.abc import Callable
from typing import Any

import httpx


API_BASE_URL = "https://hacker-news.firebaseio.com/v0"


def retain_comments_with_descendants(
    comments: list[dict[str, Any]], min_descendants: int
) -> list[dict[str, Any]]:
    """Retain substantive comments and their in-tree ancestor context.

    Descendants are counted only inside ``comments``, which is already bounded by
    the requested traversal depth. The HN API exposes immediate child IDs only.
    """
    if min_descendants == 0:
        return comments

    entries_by_id = {entry["item"]["id"]: entry for entry in comments}
    descendant_counts = {comment_id: 0 for comment_id in entries_by_id}
    for entry in reversed(comments):
        item = entry["item"]
        parent_id = item.get("parent")
        if parent_id in descendant_counts:
            descendant_counts[parent_id] += descendant_counts[item["id"]] + 1

    retained_ids = {
        comment_id
        for comment_id, descendant_count in descendant_counts.items()
        if descendant_count >= min_descendants
    }
    for comment_id in tuple(retained_ids):
        parent_id = entries_by_id[comment_id]["item"].get("parent")
        while parent_id in entries_by_id:
            retained_ids.add(parent_id)
            parent_id = entries_by_id[parent_id]["item"].get("parent")

    return [entry for entry in comments if entry["item"]["id"] in retained_ids]


class HackerNewsClient:
    """Retrieve data exclusively from the official Hacker News API."""

    def __init__(self, http_client: httpx.Client) -> None:
        self.http_client = http_client

    def top_story_ids(self) -> list[int]:
        response = self.http_client.get(f"{API_BASE_URL}/topstories.json")
        response.raise_for_status()
        return response.json()

    def item(self, item_id: int) -> dict[str, Any] | None:
        response = self.http_client.get(f"{API_BASE_URL}/item/{item_id}.json")
        response.raise_for_status()
        return response.json()

    def thread_comments(
        self,
        item: dict[str, Any],
        max_depth: int,
        on_progress: Callable[[int, int], None] | None = None,
    ) -> list[dict[str, Any]]:
        """Return comments below *item*, stopping before children past max_depth.

        Direct comments have depth 1. A max depth of 0 therefore stores no comments.
        """
        comments: list[dict[str, Any]] = []
        pending = deque((comment_id, 1) for comment_id in item.get("kids", []))
        processed = 0

        while pending:
            comment_id, depth = pending.popleft()
            processed += 1
            comment = self.item(comment_id)
            if comment is None:
                if on_progress is not None and (processed == 1 or processed % 25 == 0):
                    on_progress(processed, len(pending))
                continue
            comments.append({"depth": depth, "item": comment})
            if depth < max_depth:
                pending.extend((child_id, depth + 1) for child_id in comment.get("kids", []))
            if on_progress is not None and (processed == 1 or processed % 25 == 0):
                on_progress(processed, len(pending))

        return comments

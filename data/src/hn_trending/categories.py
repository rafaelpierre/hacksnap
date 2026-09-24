"""Versioned, title-only category assignments shared by ingestion and backfill."""

from datetime import datetime, timezone
import hashlib
from typing import Literal

Category = Literal[
    "models_products", "agents_coding", "research_evaluation",
    "infrastructure_efficiency", "safety_privacy", "industry_society",
]
CATEGORY_VERSION = "v1"
CATEGORY_FIELDS = ("category", "category_version", "category_model", "categorized_at", "category_title_hash")


def title_hash(title: str) -> str:
    return hashlib.sha256(title.encode("utf-8")).hexdigest()


def category_metadata(title: str, category: Category, model: str) -> dict:
    return dict(zip(CATEGORY_FIELDS, (
        category, CATEGORY_VERSION, model, datetime.now(timezone.utc), title_hash(title),
    )))


def reusable_category(row: dict | None, title: str, model: str) -> dict | None:
    if (row and row.get("category") and row.get("category_version") == CATEGORY_VERSION
            and row.get("category_model") == model and row.get("category_title_hash") == title_hash(title)):
        return {field: row[field] for field in CATEGORY_FIELDS}
    return None

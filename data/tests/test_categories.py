from pathlib import Path
from typing import get_args

from click.testing import CliRunner
import pytest

from hn_trending.categories import Category, CATEGORY_VERSION, category_metadata, reusable_category
from hn_trending.topic_filter import MODAL_LLM_MODEL, TopicDecision, parse_topic_decision


@pytest.mark.parametrize("payload", [
    {"relevant": True}, {"relevant": True, "category": None},
    {"relevant": False, "category": "agents_coding"},
    {"relevant": True, "category": "other"},
    {"relevant": True, "category": ["agents_coding"]},
])
def test_invalid_category_decisions_are_rejected(payload):
    with pytest.raises(ValueError):
        parse_topic_decision(payload)


def test_every_category_is_valid_and_rejected_titles_have_no_category():
    for category in get_args(Category):
        assert parse_topic_decision({"relevant": True, "category": category}).category == category
    assert parse_topic_decision({"relevant": False, "category": None}).category is None


def test_category_cache_invalidates_when_input_or_classifier_changes():
    row = category_metadata("A new agent", "agents_coding", MODAL_LLM_MODEL)
    assert reusable_category(row, "A new agent", MODAL_LLM_MODEL) == row
    assert reusable_category(row, "A new agent leaks data", MODAL_LLM_MODEL) is None
    assert reusable_category(row, "A new agent", "new-model") is None
    assert reusable_category({**row, "category_version": "old"}, "A new agent", MODAL_LLM_MODEL) is None
    assert reusable_category(None, "A new agent", MODAL_LLM_MODEL) is None


def test_website_and_ingestion_share_category_ids():
    import re
    website = Path(__file__).resolve().parents[2] / "hacksnap/web/lib/categories.ts"
    assert set(re.findall(r'id: "([a-z_]+)"', website.read_text())) == set(get_args(Category))


def test_ingestion_carries_predictions_and_reuses_unchanged_titles(monkeypatch):
    from hn_trending import cli
    from uuid import uuid4
    cached = category_metadata("Saved agent", "agents_coding", MODAL_LLM_MODEL)
    calls, stored = [], []

    class Classifier:
        model = MODAL_LLM_MODEL
        def __init__(self, *args, **kwargs): pass
        def classify(self, title):
            calls.append(title)
            return TopicDecision(relevant=title != "Unrelated", category=None if title == "Unrelated" else "safety_privacy")

    class HN:
        def __init__(self, client): pass
        def top_story_ids(self): return [1, 2, 3, 4]
        def item(self, id):
            return {"id": id, "type": "story", "time": 1, "title": ["Fresh", "Saved agent", "Unrelated", "Changed title"][id-1]}
        def thread_comments(self, *args, **kwargs): return []

    monkeypatch.setenv("MODAL_LLM_API_KEY", "test")
    monkeypatch.setenv("SUPABASE_PASSWORD", "test")
    monkeypatch.setattr(cli, "TitleTopicClassifier", Classifier)
    monkeypatch.setattr(cli, "HackerNewsClient", HN)
    monkeypatch.setattr(cli, "get_category_assignments", lambda *args: {2: cached, 4: cached})
    monkeypatch.setattr(cli, "start_ingestion_run", lambda *args: uuid4())
    monkeypatch.setattr(cli, "finish_ingestion_run", lambda *args, **kwargs: None)
    def save(url, run, rows):
        stored.extend(rows)
        return len(rows), len(rows)
    monkeypatch.setattr(cli, "store_threads_and_snapshots", save)
    result = CliRunner().invoke(cli.main, ["--classify-topic"])
    assert result.exit_code == 0, result.output
    assert calls == ["Fresh", "Unrelated", "Changed title"]
    assert [row["category"] for row in stored] == ["safety_privacy", "agents_coding", "safety_privacy"]
    assert stored[1]["categorized_at"] == cached["categorized_at"]
    assert all(row["category_version"] == CATEGORY_VERSION for row in stored)


def test_backfill_resumes_and_dry_run_never_writes(monkeypatch):
    from hn_trending import backfill_categories as backfill
    rows = [{"hn_id": i, "title": f"Title {i}"} for i in [1, 2, 3]]
    calls = []
    class Classifier:
        model = MODAL_LLM_MODEL
        def __init__(self, *args, **kwargs): pass
        def classify(self, title, *, already_relevant):
            assert already_relevant
            calls.append(title)
            return TopicDecision(relevant=True, category="models_products")
    monkeypatch.setenv("MODAL_LLM_API_KEY", "test")
    monkeypatch.setenv("SUPABASE_PASSWORD", "test")
    monkeypatch.setattr(backfill, "TitleTopicClassifier", Classifier)
    monkeypatch.setattr(backfill, "category_backfill_batch", lambda url, after: [row for row in rows if row["hn_id"] > after])
    def save(url, id, title, metadata):
        rows[id-1].update(metadata)
        return True
    monkeypatch.setattr(backfill, "save_category", save)
    runner = CliRunner()
    assert runner.invoke(backfill.main, ["--dry-run", "--limit", "1"]).exit_code == 0
    assert all("category" not in row for row in rows)
    assert runner.invoke(backfill.main, ["--limit", "1"]).exit_code == 0
    calls.clear()
    assert runner.invoke(backfill.main, []).exit_code == 0
    assert calls == ["Title 2", "Title 3"]
    calls.clear()
    assert runner.invoke(backfill.main, []).exit_code == 0
    assert calls == []

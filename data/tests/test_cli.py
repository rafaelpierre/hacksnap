from uuid import uuid4

import pytest
from botocore.session import get_session

from hn_trending.client import HackerNewsClient, retain_comments_with_descendants
from hn_trending.cli import resolve_database_url, title_matches
from hn_trending.storage import database_row, snapshot_row
from hn_trending.topic_filter import (
    CLASSIFIER_SYSTEM_PROMPT,
    QWEN3_NEXT_MODEL,
    TOPIC_DECISION_TOOL_CONFIG,
    TitleTopicClassifier,
    parse_topic_decision,
    topic_decision_from_response,
)


def test_title_words_are_case_insensitive_and_match_any_word() -> None:
    assert title_matches("AI engineering at scale", ("ai", "ENGINEERING"))
    assert title_matches("AI research", ("ai", "engineering"))
    assert not title_matches("Database research", ("ai", "engineering"))


def test_database_url_resolution_uses_the_ipv4_pooler(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_PASSWORD", "a password/with symbols")
    database_url = resolve_database_url()
    assert "a%20password%2Fwith%20symbols" in database_url
    assert "aws-1-eu-west-1.pooler.supabase.com:5432" in database_url
    assert database_url.endswith("?sslmode=require")


def test_comment_traversal_reports_progress() -> None:
    class StubHackerNewsClient(HackerNewsClient):
        def __init__(self) -> None:
            pass

        def item(self, item_id: int):
            return {"id": item_id, "kids": []}

    progress: list[tuple[int, int]] = []
    comments = StubHackerNewsClient().thread_comments(
        {"kids": [1, 2]},
        max_depth=1,
        on_progress=lambda processed, pending: progress.append((processed, pending)),
    )

    assert [comment["item"]["id"] for comment in comments] == [1, 2]
    assert progress == [(1, 1)]


def test_comment_subtree_filter_retains_qualifying_branch_and_its_ancestors() -> None:
    comments = [
        {"depth": 1, "item": {"id": 1, "parent": 100}},
        {"depth": 1, "item": {"id": 2, "parent": 100}},
        {"depth": 2, "item": {"id": 3, "parent": 1}},
        {"depth": 3, "item": {"id": 4, "parent": 3}},
        {"depth": 3, "item": {"id": 5, "parent": 3}},
        {"depth": 2, "item": {"id": 6, "parent": 2}},
    ]

    retained = retain_comments_with_descendants(comments, min_descendants=2)

    # Comment 3 qualifies directly; comment 1 remains as its context.
    assert [entry["item"]["id"] for entry in retained] == [1, 3]


def test_comment_subtree_filter_can_be_disabled() -> None:
    comments = [{"depth": 1, "item": {"id": 1, "parent": 100}}]

    assert retain_comments_with_descendants(comments, min_descendants=0) == comments


def test_topic_decision_parses_constrained_json() -> None:
    decision = parse_topic_decision({"relevant": True})

    assert decision.relevant is True


def test_topic_decision_rejects_invalid_output() -> None:
    with pytest.raises(ValueError, match="valid relevance decision"):
        parse_topic_decision({"relevant": "yes"})


def test_topic_decision_accepts_json_text_response() -> None:
    decision = topic_decision_from_response(
        {"output": {"message": {"content": [{"text": '{"relevant": true}'}]}}}
    )

    assert decision.relevant is True


def test_topic_decision_rejects_non_json_text_response() -> None:
    with pytest.raises(ValueError, match="JSON relevance output"):
        topic_decision_from_response(
            {"output": {"message": {"content": [{"text": "relevant"}]}}}
        )


def test_title_classifier_uses_bedrock_converse_parameters() -> None:
    class StrictBedrockClient:
        def __init__(self) -> None:
            self.kwargs: dict[str, object] | None = None

        def converse(
            self,
            *,
            modelId: str,
            system: list[dict[str, str]],
            messages: list[dict[str, object]],
            inferenceConfig: dict[str, int],
            toolConfig: dict[str, object],
        ):
            self.kwargs = {
                "modelId": modelId,
                "system": system,
                "messages": messages,
                "inferenceConfig": inferenceConfig,
                "toolConfig": toolConfig,
            }
            return {
                "output": {"message": {"content": [{"toolUse": {"name": "classify_topic", "input": {"relevant": True}}}]}}
            }

    client = StrictBedrockClient()
    classifier = TitleTopicClassifier("test-key", client=client)

    decision = classifier.classify("New agent framework")

    assert decision.relevant is True
    assert client.kwargs is not None
    assert client.kwargs["modelId"] == QWEN3_NEXT_MODEL
    assert client.kwargs["inferenceConfig"] == {"maxTokens": 100, "temperature": 0}
    assert client.kwargs["toolConfig"] == TOPIC_DECISION_TOOL_CONFIG


def test_topic_prompt_includes_ai_coding_assistant_ecosystem() -> None:
    prompt = CLASSIFIER_SYSTEM_PROMPT.casefold()

    for product in ("claude code", "codex", "cursor", "hermes agent"):
        assert product in prompt
    assert "bundling libreoffice" in prompt
    assert "local-model setups" in prompt
    assert "ai-labeled content" in prompt
    assert "favor inclusion when a title is ambiguous" in prompt
    assert "work, industries, professions" in prompt


def test_installed_bedrock_sdk_supports_converse_tool_schema() -> None:
    converse_input = (
        get_session().get_service_model("bedrock-runtime").operation_model("Converse").input_shape
    )
    assert converse_input is not None
    assert "toolConfig" in converse_input.members

    schema = TOPIC_DECISION_TOOL_CONFIG["tools"][0]["toolSpec"]["inputSchema"]["json"]
    assert schema["required"] == ["relevant"]
    assert schema["properties"]["relevant"]["type"] == "boolean"
    assert schema["additionalProperties"] is False


def test_database_row_contains_current_hacker_news_metrics() -> None:
    row = database_row(
        {
            "id": 1,
            "title": "Example story",
            "time": 1,
            "score": 42,
            "descendants": 24,
        },
        "{}",
        top_story_rank=1,
        max_comment_depth=2,
    )

    assert row["points"] == 42
    assert row["comment_count"] == 24
    assert row["top_story_rank"] == 1
    assert row["max_comment_depth"] == 2


def test_snapshot_row_has_stable_hash_and_parsed_payload() -> None:
    row = {
        "hn_id": 1,
        "full_raw_text_contents": '{"story": {"id": 1}}',
        "points": 42,
        "comment_count": 24,
        "top_story_rank": 3,
        "max_comment_depth": 1,
    }

    snapshot = snapshot_row(row, run_id=uuid4())

    assert snapshot["content_hash"] == "b4dc5a7020c95dfe03bf62ab0dd3dce93dc6da8664d61282e53db36451cef072"
    assert snapshot["raw_payload"].obj == {"story": {"id": 1}}
    assert snapshot["top_story_rank"] == 3

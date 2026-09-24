from uuid import uuid4

import pytest
import httpx
import json
from click.testing import CliRunner

from hn_trending.client import HackerNewsClient, retain_comments_with_descendants
from hn_trending.cli import main, resolve_database_url, title_matches
from hn_trending.storage import database_row, snapshot_row, store_threads_and_snapshots
from hn_trending.topic_filter import (
    CLASSIFIER_SYSTEM_PROMPT,
    MODAL_LLM_MODEL,
    TOPIC_DECISION_RESPONSE_FORMAT,
    IncompleteTopicResponseError,
    TitleTopicClassifier,
    parse_topic_decision,
    topic_decision_from_response,
)


def test_title_words_are_case_insensitive_and_match_any_word() -> None:
    assert title_matches("AI engineering at scale", ("ai", "ENGINEERING"))
    assert title_matches("AI research", ("ai", "engineering"))
    assert not title_matches("Database research", ("ai", "engineering"))


def test_unchanged_snapshot_still_updates_current_run_membership(monkeypatch) -> None:
    from hn_trending import storage

    run_id = uuid4()
    executions = []

    class Cursor:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def execute(self, query, params): executions.append((query, params))
        def fetchone(self): return None  # deduplicated snapshot

    class Connection(Cursor):
        def cursor(self): return Cursor()
        def commit(self): pass

    monkeypatch.setattr(storage.psycopg, "connect", lambda url: Connection())
    row = database_row({"id": 1, "title": "AI", "time": 1}, '{"story": {}}',
                       top_story_rank=1, max_comment_depth=5)
    assert store_threads_and_snapshots("test-only", run_id, [row]) == (1, 0)
    assert executions[0][1]["last_seen_run_id"] == run_id
    assert "last_seen_run_id = EXCLUDED.last_seen_run_id" in executions[0][0]
    assert "last_seen_run_id" not in row


def test_database_url_resolution_uses_the_ipv4_pooler(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_PASSWORD", "a password/with symbols")
    database_url = resolve_database_url()
    assert "a%20password%2Fwith%20symbols" in database_url
    assert "aws-1-eu-west-1.pooler.supabase.com:5432" in database_url
    assert database_url.endswith("?sslmode=require")


def test_cli_defaults_to_five_comment_levels() -> None:
    max_depth_option = next(
        parameter
        for parameter in main.params
        if parameter.name == "max_comment_depth"
    )

    assert max_depth_option.default == 5


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
    decision = parse_topic_decision({"relevant": True, "category": "agents_coding"})

    assert decision.relevant is True


def test_topic_decision_rejects_invalid_output() -> None:
    with pytest.raises(ValueError, match="valid relevance decision"):
        parse_topic_decision({"relevant": "yes"})


def test_topic_decision_accepts_json_text_response() -> None:
    decision = topic_decision_from_response(
        {"choices": [{"finish_reason": "stop", "message": {"content": '{"relevant": true, "category": "agents_coding"}'}}]}
    )

    assert decision.relevant is True


def test_topic_decision_rejects_non_json_text_response() -> None:
    with pytest.raises(ValueError, match="JSON relevance output"):
        topic_decision_from_response(
            {"choices": [{"finish_reason": "stop", "message": {"content": "relevant"}}]}
        )


def test_title_classifier_uses_modal_structured_response() -> None:
    def respond(request):
        assert str(request.url) == "https://example.modal.direct/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer test-key"
        payload = json.loads(request.content)
        assert payload["model"] == MODAL_LLM_MODEL
        assert payload["max_tokens"] == 8192
        assert payload["response_format"] == TOPIC_DECISION_RESPONSE_FORMAT
        assert json.loads(payload["messages"][1]["content"]) == {"title": "New agent framework"}
        return httpx.Response(200, json={"choices": [{
            "finish_reason": "stop", "message": {"content": '{"relevant": true, "category": "agents_coding"}'}
        }]})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        classifier = TitleTopicClassifier(
            "test-key", base_url="https://example.modal.direct/v1/", client=client
        )
        assert classifier.classify("New agent framework").relevant is True


@pytest.mark.parametrize("response", [
    {}, {"choices": []}, {"choices": None},
    {"choices": [{"finish_reason": "length", "message": {"content": '{"relevant": true, "category": "agents_coding"}'}}]},
    {"choices": [{"finish_reason": "stop", "message": {"content": None}}]},
    {"choices": [{"finish_reason": "stop", "message": {"content": '{"relevant": "yes"}'}}]},
])
def test_topic_decision_rejects_malformed_or_incomplete_responses(response):
    with pytest.raises(ValueError):
        topic_decision_from_response(response)


def test_classifier_propagates_http_failure():
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(401))) as client:
        with pytest.raises(httpx.HTTPStatusError):
            TitleTopicClassifier("bad-key", client=client).classify("AI")


def test_cli_requires_modal_key(monkeypatch):
    monkeypatch.delenv("MODAL_LLM_API_KEY", raising=False)
    result = CliRunner().invoke(main, ["--classify-topic"])
    assert result.exit_code == 2
    assert "Set MODAL_LLM_API_KEY" in result.output


def test_topic_prompt_includes_ai_coding_assistant_ecosystem() -> None:
    prompt = CLASSIFIER_SYSTEM_PROMPT.casefold()

    for product in ("claude code", "codex", "cursor", "hermes agent"):
        assert product in prompt
    assert "bundling libreoffice" in prompt
    assert "local-model setups" in prompt
    assert "ai-labeled content" in prompt
    assert "favor inclusion when a title is ambiguous" in prompt
    assert "work, industries, professions" in prompt
    assert "criticism, commentary, and analysis" in prompt


def test_topic_schema_requires_strict_boolean() -> None:
    schema = TOPIC_DECISION_RESPONSE_FORMAT["json_schema"]["schema"]
    assert schema["required"] == ["relevant", "category"]
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


@pytest.fixture
def classifier_clock(monkeypatch):
    from hn_trending import topic_filter

    class Clock:
        now = 1000.0
        sleeps = None

        def __init__(self):
            self.sleeps = []

        def sleep(self, seconds):
            self.sleeps.append(seconds)
            self.now += seconds

    clock = Clock()
    monkeypatch.setattr(topic_filter.time, "monotonic", lambda: clock.now)
    monkeypatch.setattr(topic_filter.time, "time", lambda: clock.now)
    monkeypatch.setattr(topic_filter.time, "sleep", clock.sleep)
    return clock


def successful_decision_response():
    return httpx.Response(200, json={"choices": [{
        "finish_reason": "stop", "message": {"content": '{"relevant": true, "category": "agents_coding"}'}
    }]})


def test_classifier_pauses_between_titles_but_counts_elapsed_work(classifier_clock):
    with httpx.Client(transport=httpx.MockTransport(lambda request: successful_decision_response())) as client:
        classifier = TitleTopicClassifier("key", client=client)
        classifier.classify("AI one")
        classifier_clock.now += 2  # Other ingestion work consumes part of the pause.
        classifier.classify("AI two")
        classifier_clock.now += 10
        classifier.classify("AI three")
    assert classifier_clock.sleeps == [3.0]


@pytest.mark.parametrize("retry_after,expected", [
    (None, 15.0), ("45", 45.0), ("broken", 15.0), ("-1", 15.0),
    ("Thu, 01 Jan 1970 00:17:30 GMT", 50.0),
])
def test_classifier_recovers_from_first_request_rate_limit(classifier_clock, retry_after, expected):
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        if len(requests) == 1:
            return httpx.Response(429, headers={"Retry-After": retry_after} if retry_after else {})
        return successful_decision_response()

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        assert TitleTopicClassifier("key", client=client).classify("AI").relevant
    assert len(requests) == 2
    assert requests[0] == requests[1]
    assert classifier_clock.sleeps == [expected]


def test_classifier_stops_after_bounded_rate_limit_retries(classifier_clock):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(429)

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(httpx.HTTPStatusError):
            TitleTopicClassifier("key", client=client).classify("AI")
    assert len(requests) == 5
    assert classifier_clock.sleeps == [15.0, 30.0, 60.0, 120.0]


def test_classifier_does_not_retry_before_excessive_server_cooldown(classifier_clock):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(429, headers={"Retry-After": "600"})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(httpx.HTTPStatusError):
            TitleTopicClassifier("key", client=client).classify("AI")
    assert len(requests) == 1
    assert classifier_clock.sleeps == []


def truncated_decision_response(content=None, completion_tokens=8192):
    return httpx.Response(200, json={
        "choices": [{"finish_reason": "length", "message": {
            "content": content, "reasoning_content": "Unfinished reasoning",
        }}],
        "usage": {"prompt_tokens": 1000, "completion_tokens": completion_tokens,
                  "total_tokens": 1000 + completion_tokens},
    })


@pytest.mark.parametrize("content", [None, '{"relevant":', '{"relevant": false, "category": null}'])
def test_classifier_rejects_truncation_without_retrying(classifier_clock, content):
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return truncated_decision_response(content)

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(ValueError) as error:
            TitleTopicClassifier("key", client=client).classify("Difficult AI title")

    assert len(requests) == 1
    assert requests[0]["max_tokens"] == 8192
    assert classifier_clock.sleeps == []
    assert "Difficult AI title" in str(error.value)
    assert "after 1 attempt(s), max_tokens=8192" in str(error.value)
    assert "finish_reason='length'" in str(error.value)
    assert "completion_tokens=8192" in str(error.value)
    assert "Unfinished reasoning" not in str(error.value)


@pytest.mark.parametrize("finish_reason", ["content_filter", "tool_calls", None])
def test_classifier_does_not_retry_other_unfinished_responses(classifier_clock, finish_reason):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={"choices": [{
            "finish_reason": finish_reason, "message": {"content": None},
        }]})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(ValueError) as error:
            TitleTopicClassifier("key", client=client).classify("AI")
    assert f"finish_reason={finish_reason!r}" in str(error.value)
    assert len(requests) == 1
    assert classifier_clock.sleeps == []


@pytest.mark.parametrize("usage", [None, [], "invalid", {"completion_tokens": "invalid"}])
def test_truncation_diagnostics_tolerate_missing_or_invalid_usage(usage):
    with pytest.raises(IncompleteTopicResponseError, match="finish_reason='length'"):
        topic_decision_from_response({
            "choices": [{"finish_reason": "length", "message": {"content": None}}],
            "usage": usage,
        })

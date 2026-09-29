"""Route only sentiment to GLM, preserving editorial requests and cache provenance."""
import json
from types import SimpleNamespace

import httpx
import pytest
from test_pipeline import FakeRepository, FakeSummarizer, inference_output, output, story

from pipeline.config import SENTIMENT_BASE_URL, SENTIMENT_MODEL, Settings
from pipeline.models import CommentSentiment
from pipeline.preprocess import prepare_comments
from pipeline.refresh import process_story
from pipeline.summarise import ModalSummarizer, RoutedSummarizer


def inference_env(monkeypatch):
    monkeypatch.setenv("HACKSNAP_DATABASE_URL", "unused")
    monkeypatch.setenv("MODAL_LLM_BASE_URL", "https://deepseek.example/v1")
    monkeypatch.setenv("MODAL_LLM_MODEL", "deepseek-ai/DeepSeek-V4.1-Flash")
    monkeypatch.setenv("MODAL_LLM_API_KEY", "editorial-key")
    for name in ("BASE_URL", "MODEL", "API_KEY", "REASONING_EFFORT"):
        monkeypatch.delenv(f"MODAL_SENTIMENT_{name}", raising=False)


def test_sentiment_defaults_to_glm_without_changing_editorial_settings(monkeypatch):
    inference_env(monkeypatch)
    settings = Settings.from_env()
    assert settings.llm_model == "deepseek-ai/DeepSeek-V4.1-Flash"
    assert settings.llm_base_url == "https://deepseek.example/v1"
    assert settings.sentiment_model == SENTIMENT_MODEL
    assert settings.sentiment_base_url == SENTIMENT_BASE_URL
    assert settings.sentiment_api_key == "editorial-key"
    assert settings.sentiment_reasoning_effort == "low"


def test_sentiment_can_use_separate_endpoint_credentials_and_reasoning(monkeypatch):
    inference_env(monkeypatch)
    monkeypatch.setenv("MODAL_SENTIMENT_BASE_URL", "https://sentiment.example/v1/")
    monkeypatch.setenv("MODAL_SENTIMENT_MODEL", "sentiment-model")
    monkeypatch.setenv("MODAL_SENTIMENT_API_KEY", "sentiment-key")
    monkeypatch.setenv("MODAL_SENTIMENT_REASONING_EFFORT", "high")
    settings = Settings.from_env()
    assert settings.sentiment_base_url == "https://sentiment.example/v1"
    assert settings.sentiment_model == "sentiment-model"
    assert settings.sentiment_api_key == "sentiment-key"
    assert settings.sentiment_reasoning_effort == "high"
    assert settings.llm_api_key == "editorial-key"


@pytest.mark.parametrize("endpoint", [
    "http://example.com", "https://", "https://user:password@example.com/v1",
    "https://example.com/v1?key=secret", "https://example.com/v1#fragment", "",
])
def test_invalid_sentiment_endpoint_fails_before_worker_runs(monkeypatch, endpoint):
    inference_env(monkeypatch)
    monkeypatch.setenv("MODAL_SENTIMENT_BASE_URL", endpoint)
    with pytest.raises(ValueError, match="MODAL_SENTIMENT_BASE_URL"):
        Settings.from_env()


def test_empty_sentiment_model_is_rejected(monkeypatch):
    inference_env(monkeypatch)
    monkeypatch.setenv("MODAL_SENTIMENT_MODEL", " ")
    with pytest.raises(ValueError, match="MODAL_SENTIMENT_MODEL"):
        Settings.from_env()


def test_initial_and_refreshed_sentiment_use_glm_while_editorial_stays_deepseek():
    requests = []
    comments, _ = prepare_comments(json.loads(story()["full_raw_text_contents"]))

    def handler(request):
        body = json.loads(request.content)
        name = body["response_format"]["json_schema"]["name"]
        requests.append((request.url.host, body["model"], name, request.headers["Authorization"]))
        source = json.loads(body["messages"][1]["content"])
        if name == "hacksnap_sentiment":
            assert set(source) == {"comments"}
            assert source["comments"] == comments
            result = {"sentiment": -1}
        elif name == "hacksnap_summary":
            result = inference_output()
        else:
            result = output()["discussion_analysis"]
        return httpx.Response(200, json={"choices": [{
            "finish_reason": "stop", "message": {"content": json.dumps(result)},
        }]})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        model = RoutedSummarizer(
            ModalSummarizer(client, "https://deepseek.example/v1", "deepseek", "editorial-key"),
            ModalSummarizer(client, "https://glm.example/v1", SENTIMENT_MODEL, "sentiment-key"),
        )
        summary = model.summarize({"article": "article", "comments": comments})
        assert summary.sentiment == -1  # Override the editorial response's zero.
        assert summary.article_summary == output()["article_summary"]
        assert summary.discussion_analysis.model_dump() == output()["discussion_analysis"]
        model.refresh_discussion({
            "reference_claims": output()["discussion_analysis"]["reference_claims"],
            "comments": comments,
        })
        assert model.estimate_sentiment(comments).sentiment == -1
        assert model.estimate_sentiment([]).sentiment is None
    assert requests == [
        ("deepseek.example", "deepseek", "hacksnap_summary", "Bearer editorial-key"),
        ("glm.example", SENTIMENT_MODEL, "hacksnap_sentiment", "Bearer sentiment-key"),
        ("deepseek.example", "deepseek", "hacksnap_discussion_refresh", "Bearer editorial-key"),
        ("glm.example", SENTIMENT_MODEL, "hacksnap_sentiment", "Bearer sentiment-key"),
    ]


def test_model_switch_refreshes_cached_sentiment_without_rewriting_editorial_content():
    repo, editorial, sentiment = FakeRepository(), FakeSummarizer(), FakeSummarizer()
    sentiment.model = SENTIMENT_MODEL
    item = story()
    assert process_story(item, repo, SimpleNamespace(fetch=lambda _: "article"), editorial) == "generated"
    old_summary = repo.saved[100]["summary"]
    old_analysis = repo.saved[100]["discussion_analysis_metadata"]
    model = RoutedSummarizer(editorial, sentiment)
    assert process_story(item, repo, None, model) == "sentiment_updated"
    assert repo.saved[100]["sentiment"] == -1
    assert repo.saved[100]["summary"] == old_summary
    assert repo.saved[100]["discussion_analysis_metadata"] == old_analysis
    assert repo.saved[100]["source_coverage"]["sentiment"]["model"] == SENTIMENT_MODEL
    assert process_story(item, repo, None, model) == "unchanged"
    assert editorial.calls == 1
    assert editorial.sentiment_calls == 0
    assert sentiment.sentiment_calls == 1


def test_new_summary_records_glm_sentiment_provenance():
    repo, editorial, sentiment = FakeRepository(), FakeSummarizer(), FakeSummarizer()
    sentiment.model = SENTIMENT_MODEL
    model = RoutedSummarizer(editorial, sentiment)
    assert process_story(story(), repo, SimpleNamespace(fetch=lambda _: "article"), model) == "generated"
    saved = repo.saved[100]
    assert saved["summary"].sentiment == -1
    assert saved["source_coverage"]["sentiment"]["model"] == SENTIMENT_MODEL
    assert saved["discussion_analysis_metadata"].model == editorial.model
    assert process_story(story(), repo, None, model) == "unchanged"
    assert sentiment.sentiment_calls == 1


@pytest.mark.parametrize("existing", [False, True])
def test_glm_failure_does_not_publish_a_deepseek_score_or_overwrite_existing_score(existing):
    repo, editorial = FakeRepository(), FakeSummarizer()
    if existing:
        assert process_story(story(), repo, SimpleNamespace(fetch=lambda _: "article"), editorial) == "generated"

    class BrokenSentiment(FakeSummarizer):
        model = SENTIMENT_MODEL

        def estimate_sentiment(self, comments):
            raise RuntimeError("GLM unavailable")

    result = process_story(
        story(), repo, SimpleNamespace(fetch=lambda _: "article"),
        RoutedSummarizer(editorial, BrokenSentiment()),
    )
    assert result == "failed"
    if existing:
        assert repo.saved[100]["sentiment"] == 0
    else:
        assert 100 not in repo.saved


def test_invalid_glm_score_is_rejected():
    model = RoutedSummarizer(FakeSummarizer(), SimpleNamespace(
        model=SENTIMENT_MODEL, estimate_sentiment=lambda _: CommentSentiment(sentiment=None),
    ))
    with pytest.raises(ValueError, match="omits discussion sentiment"):
        model.summarize({"article": "article", "comments": [{"id": 1}]})

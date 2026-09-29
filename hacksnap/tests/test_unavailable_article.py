"""Fallback contract tests; mocked inference does not measure model recognition accuracy."""
import json
from types import SimpleNamespace

import httpx
import pytest
from test_pipeline import FakeRepository, inference_output, output, story

from pipeline.models import ARTICLE_UNAVAILABLE_NOTICE, StorySummary
from pipeline.prompts import SYSTEM_PROMPT
from pipeline.refresh import process_story
from pipeline.summarise import ModalSummarizer

PAGES = [
    ("Markets Pre-Markets U.S. Markets Europe Markets China Markets Asia Markets "
    "World Markets Currencies Watchlist Investing Club Subscribe Livestream Menu"),
    ("This website requires javascript to properly function. Consider activating "
    'javascript to get access to all site functionality. <iframe src="tracking"></iframe>'),
    "Access denied. Verify you are human to continue.",
]


def unavailable_output():
    result = output(article=False)
    result["article_summary"] = ARTICLE_UNAVAILABLE_NOTICE
    result["overall_takeaway"] = "Article unavailable; the supplied discussion questions the costs."
    return result


@pytest.mark.parametrize("article", PAGES)
@pytest.mark.parametrize("has_comments", [True, False])
def test_unavailable_page_can_publish_without_fabricated_article_claims(article, has_comments):
    item = story()
    result = unavailable_output()
    if not has_comments:
        item["full_raw_text_contents"] = json.dumps({"story": {"id": 100}, "comments": []})
        result["sentiment"] = None
        result["discussion_points"] = []
        result["discussion_summary"] = "No usable discussion was available."
        result["discussion_analysis"]["status"] = "no_comments"
        result["overall_takeaway"] = "Neither article text nor usable discussion was available."
    repo = FakeRepository([item])

    def respond(request):
        body = json.loads(request.content)
        assert body["messages"][0]["content"] == SYSTEM_PROMPT
        assert ARTICLE_UNAVAILABLE_NOTICE in SYSTEM_PROMPT
        assert json.loads(body["messages"][1]["content"])["article"] == article
        return httpx.Response(200, json={"choices": [{
            "finish_reason": "stop",
            "message": {"content": json.dumps(inference_output(result))},
        }]})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        summarizer = ModalSummarizer(client, "https://mock.invalid/v1", "test", "fake")
        assert process_story(item, repo, SimpleNamespace(fetch=lambda _: article), summarizer) == "generated"
    saved = repo.saved[100]
    assert saved["summary"].article_summary is None
    assert json.loads(saved["summary"].model_dump_json())["article_summary"] is None
    assert ARTICLE_UNAVAILABLE_NOTICE not in saved["summary"].model_dump_json()
    assert saved["summary"].article_key_points == []
    assert saved["coverage"]["article_status"] == "unavailable"
    assert saved["discussion_analysis"].reference_claims == []
    assert not repo.failures


@pytest.mark.parametrize("field,value", [
    ("article_summary", None),
    ("article_summary", "A different unavailable notice."),
])
def test_fallback_is_explicit_not_a_blanket_validation_bypass(field, value):
    result = unavailable_output()
    result[field] = value
    with pytest.raises(ValueError, match="omits the supplied article"):
        StorySummary.model_validate(result).validate_sources("A real article.", [{"id": 1}, {"id": 2}])


@pytest.mark.parametrize("claims", [False, True])
def test_unavailable_notice_cannot_accompany_article_claims(claims):
    result = unavailable_output()
    if claims:
        result["discussion_analysis"]["status"] = "available"
        result["discussion_analysis"]["reference_claims"] = [
            {"id": "invented", "source": "article", "text": "An invented article claim."}
        ]
    else:
        result["article_key_points"] = ["An invented article key point."]
    with pytest.raises(ValueError, match="cannot contain article claims"):
        StorySummary.model_validate(result).validate_sources(PAGES[0], [{"id": 1}, {"id": 2}])


def test_story_text_claims_remain_available_when_external_article_is_unusable():
    result = unavailable_output()
    result["discussion_analysis"].update(status="available", reference_claims=[
        {"id": "post", "source": "story_text", "text": "Batching reduces costs."}
    ])
    StorySummary.model_validate(result).validate_sources(
        PAGES[0], [{"id": 1}, {"id": 2}], "Batching reduces costs."
    )


def test_no_article_still_requires_null_summary():
    with pytest.raises(ValueError, match="without an article"):
        StorySummary.model_validate(unavailable_output()).validate_sources(None, [{"id": 1}, {"id": 2}])


def test_short_genuine_article_keeps_normal_validation():
    summary = StorySummary.model_validate(output())
    summary.validate_sources("Batching reduces costs.", [{"id": 1}, {"id": 2}])
    assert not summary.article_unavailable
    summary.article_key_points = []
    with pytest.raises(ValueError, match="omits the supplied article"):
        summary.validate_sources("Batching reduces costs.", [{"id": 1}, {"id": 2}])

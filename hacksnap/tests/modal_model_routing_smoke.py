"""Synthetic smoke check with the scheduled worker's credentials; no database I/O.

From hacksnap/: uv run modal run tests/modal_model_routing_smoke.py
No schedules, production refreshes, backfills or content writes are invoked.
"""
from pathlib import Path

import modal

if modal.is_local():
    from modal_app import hacksnap_image
    image = hacksnap_image.add_local_dir(
        Path(__file__).resolve().parents[2] / "data/src/hn_trending", "/root/hn_trending",
    )
else:
    image = None

app = modal.App("hacksnap-model-routing-check")


@app.function(image=image, secrets=[modal.Secret.from_name("hacksnap")], timeout=600)
def check_routing():
    import os

    import httpx
    from hn_trending.topic_filter import TitleTopicClassifier

    from pipeline.config import SENTIMENT_MODEL, Settings
    from pipeline.refresh import discussion_source
    from pipeline.summarise import ModalSummarizer, RoutedSummarizer

    settings = Settings.from_env()
    assert settings.llm_model == "deepseek-ai/DeepSeek-V4.1-Flash"
    assert settings.sentiment_model == SENTIMENT_MODEL
    comments = [{
        "id": 101, "parent": 100, "author": "synthetic_reader", "depth": 1,
        "text": "I repeated the single-client test and also measured half the latency. Excellent result.",
    }]
    with httpx.Client(timeout=180) as client:
        classifier = TitleTopicClassifier(os.environ["MODAL_LLM_API_KEY"], client=client)
        decision = classifier.classify("Coding agent leaks private repository credentials")
        assert decision.relevant and decision.category == "safety_privacy"
        model = RoutedSummarizer(
            ModalSummarizer(client, settings.llm_base_url, settings.llm_model,
                            settings.llm_api_key, settings.llm_reasoning_effort),
            ModalSummarizer(client, settings.sentiment_base_url, settings.sentiment_model,
                            settings.sentiment_api_key or settings.llm_api_key,
                            settings.sentiment_reasoning_effort),
        )
        summary = model.summarize({
            "title": "Engine performance discussion", "article_url": None,
            "article": "The engine halves latency in our single-client test.",
            "story_text": None, "comments": comments,
        })
        assert summary.sentiment == 1
        model.refresh_discussion(discussion_source(
            comments, {"stored_comments": 1, "included_comments": 1, "comments_truncated": False},
            "synthetic-routing-check",
        ))
        assert model.estimate_sentiment(comments).sentiment == 1
        assert model.estimate_sentiment([]).sentiment is None
    return {
        "classification_model": classifier.model,
        "sentiment_model": model.sentiment_model,
        "editorial_model": model.model,
        "classification": "passed", "initial_summary": "passed",
        "discussion_refresh": "passed", "sentiment": "passed",
        "scope": "synthetic inference only; no database access or writes",
    }


@app.local_entrypoint()
def main():
    print(check_routing.remote())

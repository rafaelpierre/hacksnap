"""Measure queueing separately from request/retry time, including failures."""

import json

import pytest

from hn_trending import topic_filter


@pytest.mark.parametrize("failure", [False, True])
def test_classification_reports_lock_wait_and_request_time(monkeypatch, caplog, failure):
    caplog.set_level("INFO", logger="hn_trending")
    now = [0.0]
    monkeypatch.setattr(topic_filter.time, "perf_counter", lambda: now[0])

    class WaitLock:
        def __enter__(self):
            now[0] += 7

        def __exit__(self, *args):
            pass

    classifier = topic_filter.TitleTopicClassifier("secret")
    classifier._request_lock = WaitLock()

    def classify(*args, **kwargs):
        now[0] += 3
        if failure:
            raise ValueError("private response")
        return topic_filter.TopicDecision(relevant=False, category=None)

    monkeypatch.setattr(classifier, "_classify", classify)
    if failure:
        with pytest.raises(ValueError):
            classifier.classify("private title")
    else:
        classifier.classify("private title")
    event = json.loads(caplog.records[-1].message)
    assert event["lock_wait_seconds"] == 7
    assert event["request_and_cooldown_seconds"] == 3
    assert event["total_seconds"] == 10
    assert event["status"] == ("failed" if failure else "succeeded")
    assert "private" not in caplog.text
    assert "secret" not in caplog.text

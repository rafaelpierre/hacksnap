from unittest.mock import MagicMock

import httpx
import pytest

from pipeline.publication import dispatch, try_dispatch


@pytest.fixture
def repository():
    repository = MagicMock()
    connection = repository._connect.return_value.__enter__.return_value
    connection.execute.return_value.fetchall.return_value = [
        {"event_id": 1, "story_id": 123, "kind": "publication"},
        {"event_id": 2, "story_id": 124, "kind": "removal"},
    ]
    connection.execute.return_value.fetchone.return_value = {"pending": 0, "oldest_seconds": None}
    return repository


def test_delivery_acknowledges_only_after_success(repository, monkeypatch):
    client = MagicMock()
    monkeypatch.setattr("pipeline.publication.httpx.Client", lambda **kwargs: client)
    response = client.__enter__.return_value.post.return_value
    response.raise_for_status.return_value = None
    assert dispatch(repository, "https://hacksnap.live/api/revalidate-publication", "s" * 32) == {"delivered": 2, "failed": 0}
    sent = client.__enter__.return_value.post.call_args.kwargs
    assert sent["json"] == {"changes": [{"storyId": "123", "kind": "publication"}, {"storyId": "124", "kind": "removal"}]}
    calls = client.__enter__.return_value.post.call_args_list
    assert len(calls) == 2
    assert "X-Hacksnap-Publication-Phase" not in calls[0].kwargs["headers"]
    assert calls[1].kwargs["headers"]["X-Hacksnap-Publication-Phase"] == "warm"
    statements = [args[0] for args, _ in repository._connect.return_value.__enter__.return_value.execute.call_args_list]
    assert "FOR UPDATE SKIP LOCKED" in statements[0]
    assert "delivered_at = clock_timestamp()" in statements[1]


def test_failure_retries_without_acknowledging(repository, monkeypatch):
    client = MagicMock()
    monkeypatch.setattr("pipeline.publication.httpx.Client", lambda **kwargs: client)
    client.__enter__.return_value.post.side_effect = httpx.TimeoutException("private URL")
    assert dispatch(repository, "https://hacksnap.live/api/revalidate-publication", "s" * 32) == {"delivered": 0, "failed": 2}
    statements = [args[0] for args, _ in repository._connect.return_value.__enter__.return_value.execute.call_args_list]
    assert "make_interval" in statements[1]
    assert not any("SET delivered_at" in sql for sql in statements)


def test_warm_failure_retries_the_whole_delivery_and_recovers(repository, monkeypatch):
    client = MagicMock()
    monkeypatch.setattr("pipeline.publication.httpx.Client", lambda **kwargs: client)
    post = client.__enter__.return_value.post
    post.side_effect = [MagicMock(), httpx.TimeoutException("warming failed")]
    url = "https://hacksnap.live/api/revalidate-publication"
    assert dispatch(repository, url, "s" * 32) == {"delivered": 0, "failed": 2}
    execute = repository._connect.return_value.__enter__.return_value.execute
    assert not any("SET delivered_at" in call.args[0] for call in execute.call_args_list)
    first_lease = execute.call_args_list[0].args[1][1]
    execute.reset_mock()
    post.side_effect = None
    assert dispatch(repository, url, "s" * 32) == {"delivered": 2, "failed": 0}
    assert execute.call_args_list[0].args[1][1] != first_lease
    assert post.call_args_list[0].kwargs["json"] == post.call_args_list[2].kwargs["json"]
    assert "WHERE lease_id = %s AND delivered_at IS NULL" in execute.call_args_list[1].args[0]


def test_worker_termination_leaves_claimed_notifications_pending(repository, monkeypatch):
    client = MagicMock()
    monkeypatch.setattr("pipeline.publication.httpx.Client", lambda **kwargs: client)
    client.__enter__.return_value.post.side_effect = KeyboardInterrupt()
    with pytest.raises(KeyboardInterrupt):
        dispatch(repository, "https://hacksnap.live/api/revalidate-publication", "s" * 32)
    statements = repository._connect.return_value.__enter__.return_value.execute.call_args_list
    assert len(statements) == 1
    assert "available_at <= clock_timestamp()" in statements[0].args[0]
    assert "interval '2 minutes'" in statements[0].args[0]


def test_immediate_dispatch_failure_does_not_fail_publication(monkeypatch, caplog):
    monkeypatch.setattr("pipeline.publication.dispatch_from_env", MagicMock(side_effect=RuntimeError("secret diagnostic")))
    try_dispatch()
    assert "RuntimeError" in caplog.text
    assert "secret diagnostic" not in caplog.text

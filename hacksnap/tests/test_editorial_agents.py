"""Optional SDK transport tests; run with uv run --extra editorial pytest."""
import asyncio
import json

import httpx
import pytest
from pydantic import BaseModel
from test_editorial_review import FakeInference, verdict

pytest.importorskip("agents")
from pipeline.editorial_agents import AgentInference
from pipeline.editorial_review import (
    InferenceOutputError,
    InferenceTimeoutError,
    reviewed_generation,
)

pytest_plugins = ["test_editorial_review"]


class Answer(BaseModel):
    text: str


@pytest.mark.parametrize("transport_timeout", [True, False])
def test_timeout_is_classified_without_hidden_retry_or_sensitive_logs(
        transport_timeout, expire_editorial_deadline):
    requests = []

    async def response(request):
        requests.append(request)
        if transport_timeout:
            raise httpx.ReadTimeout("private request details", request=request)
        expire_editorial_deadline()
        await asyncio.Event().wait()

    async def run():
        client = AgentInference("https://example.invalid/v1", "secret-key", "test-model",
                                transport=httpx.MockTransport(response))
        try:
            with pytest.raises(InferenceTimeoutError, match="timed out"):
                await client.infer("reviewer_repair", "Review", {}, Answer)
            assert len(requests) == 1
            assert client.calls[0]["status"] == "failed"
            assert client.calls[0]["failure_kind"] == "timeout"
            assert "private request details" not in json.dumps(client.calls)
            assert "secret-key" not in json.dumps(client.calls)
        finally:
            await client.close()

    asyncio.run(run())


@pytest.mark.parametrize("finish_reason", ["stop", "length", "content_filter"])
def test_sdk_request_contract_and_incomplete_response_rejection(finish_reason):
    requests = []

    def response(request):
        body = json.loads(request.content)
        requests.append(body)
        assert body["reasoning_effort"] == "low"
        assert body["response_format"]["type"] == "json_schema"
        assert body["response_format"]["json_schema"]["strict"]
        assert body["max_tokens"] == 32000
        assert not body.get("tools")
        return httpx.Response(200, json={
            "id": "test", "object": "chat.completion", "created": 1, "model": "test-model",
            "choices": [{"index": 0, "finish_reason": finish_reason,
                         "message": {"role": "assistant", "content": '{"text":"valid"}'}}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 7, "total_tokens": 19},
        })

    async def run():
        client = AgentInference("https://example.invalid/v1", "test-key", "test-model",
                                transport=httpx.MockTransport(response))
        try:
            if finish_reason == "stop":
                result = await client.infer("reviewer", "Review", {"source": "data"}, Answer)
                assert result.text == "valid"
            else:
                with pytest.raises(ValueError, match="did not complete"):
                    await client.infer("reviewer", "Review", {"source": "data"}, Answer)
            assert len(requests) == 1
            assert client.calls[0]["input_tokens"] == 12
            assert client.calls[0]["output_tokens"] == 7
            assert client.calls[0]["status"] == ("succeeded" if finish_reason == "stop" else "failed")
            assert "test-key" not in json.dumps(client.calls)
        finally:
            await client.close()

    asyncio.run(run())


def test_http_failure_has_no_hidden_retry_and_no_publishable_output():
    from openai import InternalServerError

    requests = []

    def response(request):
        requests.append(request)
        return httpx.Response(503, json={"error": {"message": "unavailable"}})

    async def run():
        client = AgentInference("https://example.invalid/v1", "test-key", "test-model",
                                transport=httpx.MockTransport(response))
        try:
            with pytest.raises(InternalServerError):
                await client.infer("writer", "Write", {}, Answer)
            assert len(requests) == 1
            assert client.calls[0]["status"] == "failed"
            assert client.calls[0]["input_tokens"] is None
        finally:
            await client.close()

    asyncio.run(run())


@pytest.mark.parametrize("content", ['{"text":', '{"wrong_field":"sensitive output"}'])
def test_completed_invalid_output_is_classified_for_bounded_repair(content):
    requests = []

    def response(request):
        requests.append(request)
        return httpx.Response(200, json={
            "id": "test", "object": "chat.completion", "created": 1, "model": "test-model",
            "choices": [{"index": 0, "finish_reason": "stop",
                         "message": {"role": "assistant", "content": content}}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 7, "total_tokens": 19},
        })

    async def run():
        client = AgentInference("https://example.invalid/v1", "test-key", "test-model",
                                transport=httpx.MockTransport(response), capture_outputs=True)
        try:
            with pytest.raises(InferenceOutputError, match="JSON or schema"):
                await client.infer("reviewer", "Review", {}, Answer)
            assert len(requests) == 1 and not client.outputs
            assert client.calls[0]["status"] == "failed"
            assert client.calls[0]["failure_kind"] == "invalid_output"
            assert client.calls[0]["finish_reason"] == "stop"
            assert "sensitive output" not in json.dumps(client.calls)
        finally:
            await client.close()

    asyncio.run(run())


@pytest.mark.parametrize("recover", [True, False])
def test_sdk_malformed_reviews_use_shared_repair_budget(recover, source, draft):
    requests = []

    def response(request):
        body = json.loads(request.content)
        requests.append(body)
        content = (verdict(draft).model_dump_json() if recover and len(requests) == 6
                   else '{"checks":')
        return httpx.Response(200, json={
            "id": "test", "object": "chat.completion", "created": 1, "model": "test-model",
            "choices": [{"index": 0, "finish_reason": "stop",
                         "message": {"role": "assistant", "content": content}}],
        })

    async def run():
        client = AgentInference("https://example.invalid/v1", "test-key", "test-model",
                                transport=httpx.MockTransport(response))
        writer = FakeInference([draft])
        try:
            result = await reviewed_generation(writer, client, source)
            assert result.status == ("accepted" if recover else "unreviewed")
            assert result.draft == draft.model_dump()
            assert len(requests) == 6 and len(writer.calls) == 1
            for request in requests[1:]:
                payload = json.loads(request["messages"][-1]["content"])
                assert json.loads(request["messages"][2]["content"])["draft"] == draft.model_dump()
                assert json.loads(request["messages"][1]["content"])["article"] == source["article"]
                assert request["messages"][:3] == requests[0]["messages"]
                assert payload["previous_review"] is None
                assert payload["validation_errors"]["kind"] == "invalid_output"
        finally:
            await client.close()

    asyncio.run(run())


def completion_response(content='{"text":"valid"}', usage=None):
    payload = {
        "id": "test", "object": "chat.completion", "created": 1, "model": "test-model",
        "choices": [{"index": 0, "finish_reason": "stop",
                     "message": {"role": "assistant", "content": content}}],
    }
    if usage is not None:
        payload["usage"] = usage
    return httpx.Response(200, json=payload)


@pytest.mark.parametrize("usage, expected", [
    ({"prompt_tokens_details": {"cached_tokens": 1536}}, 1536),
    ({"prompt_cache_hit_tokens": 1024}, 1024),
    ({"prompt_tokens_details": {"cached_tokens": 0}, "prompt_cache_hit_tokens": 1024}, 0),
    ({}, None),
    ({"prompt_tokens_details": {"cached_tokens": True}}, None),
    ({"prompt_tokens_details": {"cached_tokens": -1}}, None),
])
def test_cached_token_telemetry_distinguishes_missing_zero_and_hits(usage, expected):
    async def run():
        client = AgentInference("https://example.invalid/v1", "secret", "test-model",
            transport=httpx.MockTransport(lambda _: completion_response(usage={
                "prompt_tokens": 2048, "completion_tokens": 7, "total_tokens": 2055, **usage,
            })))
        try:
            await client.infer("writer", "Write", {}, Answer)
            assert client.calls[0]["cached_input_tokens"] == expected
            assert client.calls[0]["request_seconds"] >= 0
            assert client.calls[0]["warmup_owner"] is True
        finally:
            await client.close()
    asyncio.run(run())


def test_full_review_loop_preserves_wire_prefixes_and_separate_model_affinity(source, draft):
    from pipeline.editorial_cache import EditorialCache
    from pipeline.editorial_review import REVIEW_REPAIR_PROMPT, REVISION_PROMPT

    requests = {"writer": [], "reviewer": []}
    responses = {"writer": [draft, draft], "reviewer": [None, verdict(draft, True), verdict(draft)]}
    cache = EditorialCache()

    def transport(kind):
        def response(request):
            requests[kind].append((dict(request.headers), json.loads(request.content)))
            value = responses[kind].pop(0)
            return completion_response(value.model_dump_json() if value else '{"checks":')
        return httpx.MockTransport(response)

    async def run():
        writer = AgentInference("https://writer.invalid/v1", "writer-secret", "deepseek",
                                cache=cache, transport=transport("writer"))
        reviewer = AgentInference("https://reviewer.invalid/v1", "reviewer-secret", "glm",
                                  cache=cache, transport=transport("reviewer"))
        try:
            result = await reviewed_generation(writer, reviewer, source)
            assert result.status == "accepted"
            assert result.draft == draft.model_dump()
            assert [c["warmup_owner"] for c in writer.calls] == [True, False]
            assert [c["warmup_owner"] for c in reviewer.calls] == [True, False, False]
            logs = json.dumps(writer.calls + reviewer.calls)
            assert source["article"] not in logs and "secret" not in logs
        finally:
            await writer.close()
            await reviewer.close()
    asyncio.run(run())
    write, revision = [body for _, body in requests["writer"]]
    review, repair, final_review = [body for _, body in requests["reviewer"]]
    assert write["messages"][0]["role"] == "system"
    assert write["messages"] == revision["messages"][:2]
    assert write["response_format"] == revision["response_format"]
    assert REVISION_PROMPT in write["messages"][0]["content"]
    assert review["messages"] == repair["messages"][:3]
    assert review["messages"][:2] == final_review["messages"][:2]
    assert review["response_format"] == repair["response_format"] == final_review["response_format"]
    assert REVIEW_REPAIR_PROMPT in review["messages"][0]["content"]
    assert json.loads(repair["messages"][-1]["content"])["validation_errors"]["kind"] == "invalid_output"
    for calls in requests.values():
        keys = {headers["modal-routing-affinity-key"] for headers, _ in calls}
        assert len(keys) == 1
        assert all("modal-session-id" not in headers for headers, _ in calls)
    assert requests["writer"][0][0]["modal-routing-affinity-key"] != requests["reviewer"][0][0]["modal-routing-affinity-key"]


@pytest.mark.parametrize("first_fails", [False, True])
def test_shared_batch_warmup_spans_clients_and_event_loops(first_fails):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, Event, Lock

    from openai import InternalServerError

    from pipeline.editorial_cache import EditorialCache

    first_started, release, waiting = Event(), Event(), Event()
    followers = Barrier(2, timeout=5)
    lock = Lock()
    keys, completed = [], []

    class ObservedCache(EditorialCache):
        def claim(self, *args):
            claim = super().claim(*args)
            if not claim[2]:
                waiting.set()
            return claim

    cache = ObservedCache()

    def response(request):
        with lock:
            keys.append(request.headers["Modal-Routing-Affinity-Key"])
            index = len(keys)
        if index == 1:
            first_started.set()
            assert release.wait(5)
            if first_fails:
                return httpx.Response(503, json={"error": {"message": "unavailable"}})
        else:
            followers.wait()
        return completion_response()

    def job(number):
        async def run():
            client = AgentInference("https://example.invalid/v1", "secret", "test-model",
                                    cache=cache, transport=httpx.MockTransport(response))
            try:
                if number == 0 and first_fails:
                    with pytest.raises(InternalServerError):
                        await client.infer("writer", "Write", {"story": number}, Answer)
                else:
                    assert (await client.infer("writer", "Write", {"story": number}, Answer)).text == "valid"
                with lock:
                    completed.extend(client.calls)
            finally:
                await client.close()
        asyncio.run(run())

    with ThreadPoolExecutor(max_workers=3) as pool:
        first = pool.submit(job, 0)
        try:
            assert first_started.wait(5)
            rest = [pool.submit(job, number) for number in (1, 2)]
            assert waiting.wait(5)
            assert len(keys) == 1
        finally:
            release.set()
        for future in [first, *rest]:
            future.result(timeout=10)
    assert len(keys) == 3 and len(set(keys)) == 1
    assert sum(record["warmup_owner"] for record in completed) == 1


@pytest.mark.parametrize("cancel_owner", [False, True])
def test_cancelling_a_warmup_or_waiter_does_not_poison_shared_gate(cancel_owner):
    from pipeline.editorial_cache import EditorialCache

    async def run():
        started, waiting, release = asyncio.Event(), asyncio.Event(), asyncio.Event()
        requests = []

        class ObservedCache(EditorialCache):
            async def wait(self, completion):
                waiting.set()
                await super().wait(completion)

        async def response(request):
            requests.append(request)
            if len(requests) == 1:
                started.set()
                await release.wait()
            return completion_response()

        cache = ObservedCache()
        clients = [AgentInference("https://example.invalid/v1", "secret", "test-model",
                                  cache=cache, transport=httpx.MockTransport(response)) for _ in range(3)]
        tasks = []
        try:
            tasks.append(asyncio.create_task(clients[0].infer("writer", "Write", {}, Answer)))
            await started.wait()
            tasks.append(asyncio.create_task(clients[1].infer("writer", "Write", {}, Answer)))
            await waiting.wait()
            cancelled = tasks[0 if cancel_owner else 1]
            cancelled.cancel()
            with pytest.raises(asyncio.CancelledError):
                await cancelled
            release.set()
            assert (await tasks[1 if cancel_owner else 0]).text == "valid"
            assert (await clients[2].infer("writer", "Write", {}, Answer)).text == "valid"
        finally:
            release.set()
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            for client in clients:
                await client.close()
    asyncio.run(asyncio.wait_for(run(), timeout=5))


def test_prefix_identity_isolates_different_models_schemas_settings_and_batches():
    from pipeline.editorial_cache import EditorialCache

    class OtherAnswer(BaseModel):
        number: int

    cache = EditorialCache()
    base = ["https://example.invalid/v1", "model", "high", "Instructions", Answer.model_json_schema()]
    first = cache.claim(*base)
    again = cache.claim(*base)
    assert first[0] == again[0] and first[3] is again[3]
    assert first[2] and not again[2]
    for index, value in enumerate(["https://other.invalid/v1", "other", "low", "New instructions", OtherAnswer.model_json_schema()]):
        changed = list(base)
        changed[index] = value
        claim = cache.claim(*changed)
        assert claim[0] != first[0] and claim[2]
    assert EditorialCache().claim(*base)[0] != first[0]

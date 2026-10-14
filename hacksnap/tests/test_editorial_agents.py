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
                assert payload["draft"] == draft.model_dump()
                assert payload["sources"]["article"] == source["article"]
                assert payload["previous_review"] is None
                assert payload["validation_errors"]["kind"] == "invalid_output"
        finally:
            await client.close()

    asyncio.run(run())

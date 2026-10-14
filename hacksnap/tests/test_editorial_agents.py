"""Optional SDK transport tests; run with uv run --extra editorial pytest."""
import asyncio
import json

import httpx
import pytest
from pydantic import BaseModel

pytest.importorskip("agents")
from pipeline.editorial_agents import AgentInference


class Answer(BaseModel):
    text: str


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

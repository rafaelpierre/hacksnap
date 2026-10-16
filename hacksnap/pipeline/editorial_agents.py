"""OpenAI Agents SDK adapter for Modal-hosted editorial inference."""
import asyncio
from time import perf_counter
from uuid import uuid4

import httpx
from agents import Agent, ModelSettings, OpenAIChatCompletionsModel, RunConfig, Runner
from agents.exceptions import ModelBehaviorError
from agents.model_settings import ModelRetrySettings
from openai import APITimeoutError, AsyncOpenAI
from pydantic import BaseModel, ValidationError

from .editorial_cache import EditorialCache
from .editorial_review import InferenceOutputError, InferenceTimeoutError, source_json

REQUEST_FORMAT_VERSION = "v2-source-prefix"


def input_messages(role: str, payload: dict) -> list[dict]:
    if role in {"revision", "reviewer", "reviewer_repair"} and "sources" in payload:
        # Keep the original source identical to the writer's first user message.
        # Drafts, checks and repair feedback change only the trailing message.
        messages = [
            {"role": "user", "content": source_json(payload["sources"])},
            {"role": "user", "content": source_json({
                key: value for key, value in payload.items()
                if key not in {"sources", "previous_review", "validation_errors"}
            })},
        ]
        feedback = {key: payload[key] for key in ("previous_review", "validation_errors")
                    if key in payload}
        if feedback:
            messages.append({"role": "user", "content": source_json(feedback)})
        return messages
    return [{"role": "user", "content": source_json(payload)}]


class AgentInference:
    def __init__(self, base_url: str, api_key: str, model: str, effort: str = "low",
                 timeout: float = 240, transport=None, capture_outputs: bool = False,
                 cache: EditorialCache | None = None, max_tokens: int = 32000):
        self.base_url = base_url
        self.model = model
        self.effort = effort
        self.timeout = timeout
        self.max_tokens = max_tokens
        self.calls = []
        self.outputs = []
        self.capture_outputs = capture_outputs
        self._active_record = None
        self._http = httpx.AsyncClient(transport=transport, timeout=timeout,
                                      event_hooks={"response": [self._check_completion]})
        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key, max_retries=0,
                                   http_client=self._http, timeout=timeout)
        self._model = OpenAIChatCompletionsModel(model=model, openai_client=self._client)
        self._cache = cache if cache is not None else EditorialCache()
        # Each client belongs to one story's writer or reviewer conversation.
        self._conversation_id = str(uuid4())

    async def _check_completion(self, response):
        if response.status_code < 400:
            await response.aread()
            payload = response.json()
            choices = payload.get("choices", [])
            if self._active_record is not None:
                usage = payload.get("usage") or {}
                self._active_record.update(
                    input_tokens=usage.get("prompt_tokens"),
                    output_tokens=usage.get("completion_tokens"),
                    finish_reason=choices[0].get("finish_reason") if choices else None,
                )
                details = usage.get("prompt_tokens_details")
                cached = details.get("cached_tokens") if isinstance(details, dict) else None
                if cached is None:
                    cached = usage.get("prompt_cache_hit_tokens")
                if type(cached) is int and cached >= 0:
                    self._active_record["cached_input_tokens"] = cached
            if not choices or choices[0].get("finish_reason") != "stop":
                raise ValueError("Inference did not complete normally")

    async def infer(self, role: str, prompt: str, payload: dict,
                    schema: type[BaseModel]) -> BaseModel:
        started = perf_counter()
        record = {"role": role, "model": self.model, "reasoning_effort": self.effort,
                  "status": "failed", "input_tokens": None, "output_tokens": None,
                  "cached_input_tokens": None}
        fingerprint, owner, completion = self._cache.claim(
            self.base_url, self.model, self.effort, prompt, schema.model_json_schema(),
        )
        affinity = f"{self._conversation_id}-{fingerprint[:20]}"
        record.update(prefix_fingerprint=fingerprint, warmup_owner=owner)
        request_started = None
        self._active_record = record
        try:
            agent = Agent(
                name=f"editorial_{role}", instructions=prompt, model=self._model,
                output_type=schema,
                model_settings=ModelSettings(
                    temperature=0.2, max_tokens=self.max_tokens, retry=ModelRetrySettings(max_retries=0),
                    extra_body={"reasoning_effort": self.effort},
                    extra_headers={"Modal-Routing-Affinity-Key": affinity},
                ),
            )
            if not owner:
                await self._cache.wait(completion)
            async with asyncio.timeout(self.timeout):
                request_started = perf_counter()
                result = await Runner.run(
                    agent, input_messages(role, payload), max_turns=1,
                    run_config=RunConfig(tracing_disabled=True, trace_include_sensitive_data=False),
                )
            value = schema.model_validate(result.final_output)
            record.update(status="succeeded", requests=result.context_wrapper.usage.requests)
            if self.capture_outputs:
                self.outputs.append({"role": role, "output": value.model_dump()})
            return value
        except (TimeoutError, httpx.TimeoutException, APITimeoutError):
            record["failure_kind"] = "timeout"
            raise InferenceTimeoutError("Editorial inference timed out") from None
        except (ModelBehaviorError, ValidationError) as error:
            if isinstance(error, ModelBehaviorError) and not str(error).startswith(
                    "Invalid JSON when parsing"):
                raise
            record["failure_kind"] = "invalid_output"
            raise InferenceOutputError("Model output failed JSON or schema validation") from None
        finally:
            if owner:
                completion.set_result(None)
            finished = perf_counter()
            record["warmup_wait_seconds"] = round(
                (request_started if request_started is not None else finished) - started, 3,
            )
            record["request_seconds"] = (
                round(finished - request_started, 3) if request_started is not None else 0
            )
            record["elapsed_seconds"] = round(finished - started, 3)
            self.calls.append(record)
            self._active_record = None

    async def close(self):
        await self._client.close()

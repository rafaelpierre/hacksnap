"""OpenAI Agents SDK adapter for the optional, inference-only editorial prototype."""
import asyncio
from time import perf_counter
from uuid import uuid4

import httpx
from agents import Agent, ModelSettings, OpenAIChatCompletionsModel, RunConfig, Runner
from agents.model_settings import ModelRetrySettings
from openai import AsyncOpenAI
from pydantic import BaseModel

from .editorial_review import source_json


class AgentInference:
    def __init__(self, base_url: str, api_key: str, model: str, effort: str = "low",
                 timeout: float = 240, transport=None, capture_outputs: bool = False):
        self.model = model
        self.effort = effort
        self.timeout = timeout
        self.calls = []
        self.outputs = []
        self.capture_outputs = capture_outputs
        self._active_record = None
        self._http = httpx.AsyncClient(transport=transport, timeout=timeout,
                                      event_hooks={"response": [self._check_completion]})
        self._client = AsyncOpenAI(base_url=base_url, api_key=api_key, max_retries=0,
                                   http_client=self._http, timeout=timeout)
        self._model = OpenAIChatCompletionsModel(model=model, openai_client=self._client)
        self._session = str(uuid4())

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
            if not choices or choices[0].get("finish_reason") != "stop":
                raise ValueError("Inference did not complete normally")

    async def infer(self, role: str, prompt: str, payload: dict,
                    schema: type[BaseModel]) -> BaseModel:
        started = perf_counter()
        record = {"role": role, "model": self.model, "reasoning_effort": self.effort,
                  "status": "failed", "input_tokens": None, "output_tokens": None}
        self._active_record = record
        try:
            agent = Agent(
                name=f"editorial_{role}", instructions=prompt, model=self._model,
                output_type=schema,
                model_settings=ModelSettings(
                    temperature=0.2, max_tokens=32000, retry=ModelRetrySettings(max_retries=0),
                    extra_body={"reasoning_effort": self.effort},
                    extra_headers={"Modal-Session-Id": self._session},
                ),
            )
            async with asyncio.timeout(self.timeout):
                result = await Runner.run(
                    agent, source_json(payload), max_turns=1,
                    run_config=RunConfig(tracing_disabled=True, trace_include_sensitive_data=False),
                )
            value = schema.model_validate(result.final_output)
            record.update(status="succeeded", requests=result.context_wrapper.usage.requests)
            if self.capture_outputs:
                self.outputs.append({"role": role, "output": value.model_dump()})
            return value
        finally:
            record["elapsed_seconds"] = round(perf_counter() - started, 3)
            self.calls.append(record)
            self._active_record = None

    async def close(self):
        await self._client.close()

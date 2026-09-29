"""Logfire lifecycle for Modal jobs (one configuration per warm container)."""

import inspect
import logging
from contextlib import contextmanager
from contextvars import ContextVar
from functools import wraps

import logfire
from logfire import LogfireLoggingHandler

LOGGER_NAME = "hacksnap"
_configured = False
_operation_span = ContextVar("operation_span", default=None)


@contextmanager
def telemetry_run(service_name: str, job_name: str):
    """Group outgoing HTTP requests and flush even when the job raises."""
    global _configured
    if not _configured:
        logfire.configure(
            service_name=service_name,
            send_to_logfire="if-token-present",
            console=False,
        )
        logfire.instrument_system_metrics()
        # The inference clients use HTTPX directly, including module-level post().
        # Rich LLM payloads are captured separately by post_chat_completion().
        logfire.instrument_httpx(
            capture_headers=False, capture_request_body=False, capture_response_body=False,
        )
        _configure_logging()
        _configured = True
    try:
        with logfire.span("Modal job {job_name}", job_name=job_name):
            try:
                yield
            except Exception as error:
                report_error(error, operation=job_name, handled=False)
                raise
    finally:
        # Modal can suspend or stop the container as soon as the function returns.
        logfire.force_flush(timeout_millis=5000)


def post_chat_completion(client, url: str, **kwargs):
    """Trace our non-streaming OpenAI-compatible calls without changing HTTP behavior."""
    if not _configured:
        return client.post(url, **kwargs)

    request = kwargs["json"]
    attributes = {
        "gen_ai.system": "openai",
        "gen_ai.provider.name": "modal",
        "gen_ai.operation.name": "chat",
        "gen_ai.request.model": request.get("model"),
        # Full JSON retains reasoning_effort, schema, and future inference parameters.
        # Headers (API key and session affinity) are deliberately excluded.
        "request_data": request,
        "gen_ai.input.messages": _messages(request.get("messages", [])),
    }
    for parameter in ("temperature", "max_tokens", "top_p", "seed", "reasoning_effort"):
        if parameter in request:
            attributes[f"gen_ai.request.{parameter}"] = request[parameter]
    with logfire.span("Chat completion with {gen_ai.request.model}", **attributes) as span:
        response = client.post(url, **kwargs)
        span.set_attribute("http.response.status_code", response.status_code)
        if response.status_code >= 400:
            span.set_level("error")
            span.set_attribute("error.type", str(response.status_code))
        try:
            payload = response.json()
        except ValueError:
            # Preserve the caller's existing HTTP/JSON error handling and retries.
            return response
        if isinstance(payload, dict):
            span.set_attributes(_completion_attributes(payload))
        return response


def _messages(messages: list) -> list[dict]:
    """Normalize the text messages used by these pipelines for Logfire's LLM views."""
    return [
        {"role": message.get("role", "assistant"),
         "parts": [{"type": "text", "content": message["content"]}]}
        for message in messages
        if isinstance(message, dict) and isinstance(message.get("content"), str)
    ]


def _completion_attributes(payload: dict) -> dict:
    attributes = {"response_data": payload}
    for key in ("id", "model"):
        if isinstance(payload.get(key), str):
            attributes[f"gen_ai.response.{key}"] = payload[key]
    choices = payload.get("choices")
    if isinstance(choices, list):
        choices = [choice for choice in choices if isinstance(choice, dict)]
        attributes["gen_ai.output.messages"] = _messages(
            [choice.get("message") for choice in choices]
        )
        attributes["gen_ai.response.finish_reasons"] = [
            choice["finish_reason"] for choice in choices
            if isinstance(choice.get("finish_reason"), str)
        ]
    usage = payload.get("usage")
    if isinstance(usage, dict):
        attributes["gen_ai.usage.raw"] = usage
        for source, target in (
            ("prompt_tokens", "input_tokens"),
            ("completion_tokens", "output_tokens"),
            ("total_tokens", "total_tokens"),
        ):
            value = usage.get(source)
            if type(value) is int and value >= 0:
                attributes[f"gen_ai.usage.{target}"] = value
        details = usage.get("prompt_tokens_details")
        cached = details.get("cached_tokens") if isinstance(details, dict) else None
        # DeepSeek may report cache hits at the top level instead of OpenAI's details.
        if cached is None:
            cached = usage.get("prompt_cache_hit_tokens")
        if type(cached) is int and cached >= 0:
            attributes["gen_ai.usage.cache_read.input_tokens"] = cached
        details = usage.get("completion_tokens_details")
        reasoning = details.get("reasoning_tokens") if isinstance(details, dict) else None
        if type(reasoning) is int and reasoning >= 0:
            attributes["gen_ai.usage.reasoning_tokens"] = reasoning
    return attributes


@contextmanager
def operation_span(operation: str, **attributes):
    """Keep validation and persistence failures inside the operation's trace."""
    if not _configured:
        yield
        return
    with logfire.span("Workflow {operation}", operation=operation, **attributes) as span:
        token = _operation_span.set(span)
        try:
            yield
        except Exception as error:
            report_error(error, operation=operation, handled=False, **attributes)
            raise
        finally:
            _operation_span.reset(token)


def traced_operation(operation: str, *, model_attribute: str = "model"):
    """Trace synchronous operations without capturing their arguments or credentials."""
    def decorate(function):
        signature = inspect.signature(function)

        @wraps(function)
        def wrapped(*args, **kwargs):
            if not _configured:
                return function(*args, **kwargs)
            arguments = signature.bind(*args, **kwargs).arguments
            attributes = {}
            story = arguments.get("story")
            if isinstance(story, dict) and "hn_id" in story:
                attributes["story_id"] = story["hn_id"]
            if "story_id" in arguments:
                attributes["story_id"] = arguments["story_id"]
            model = getattr(arguments.get("self"), model_attribute, None)
            if isinstance(model, str):
                attributes["model"] = model
            with operation_span(operation, **attributes):
                return function(*args, **kwargs)
        return wrapped
    return decorate


def report_error(error: Exception, *, operation: str, handled: bool = True, **attributes):
    """Record isolated failures even when the enclosing Modal job succeeds."""
    if not _configured:
        return
    attributes = {**attributes, "operation": operation, "error_type": type(error).__name__,
                  "handled": handled}
    span = _operation_span.get()
    if span is not None:
        span.set_level("error")
        span.set_attribute("error.type", type(error).__name__)
        if handled:
            span.record_exception(error)
    logfire.exception("Workflow {operation} failed", _exc_info=error, **attributes)


def _configure_logging():
    logger = logging.getLogger(LOGGER_NAME)
    # Keep stdout handlers intact and avoid duplicates across warm invocations.
    if not any(isinstance(handler, LogfireLoggingHandler) for handler in logger.handlers):
        logger.addHandler(LogfireLoggingHandler())
    logger.setLevel(logging.INFO)

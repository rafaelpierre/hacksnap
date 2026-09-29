"""Exercise telemetry lifecycle and real HTTPX instrumentation without network access."""

from unittest.mock import MagicMock

import httpx
import logfire
import pytest
from logfire.testing import TestExporter as SpanExporter
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.instrumentation.system_metrics import SystemMetricsInstrumentor
from opentelemetry.sdk.metrics.export import InMemoryMetricReader
from opentelemetry.sdk.trace.export import SimpleSpanProcessor

from hn_trending import telemetry


def test_warm_jobs_configure_once_and_flush_on_failure(monkeypatch):
    sdk = MagicMock()
    monkeypatch.setattr(telemetry, "logfire", sdk)
    monkeypatch.setattr(telemetry, "_configured", False)
    with telemetry.telemetry_run("worker", "first"):
        pass
    with (
        pytest.raises(ValueError, match="job failed"),
        telemetry.telemetry_run("worker", "second"),
    ):
        raise ValueError("job failed")
    sdk.configure.assert_called_once_with(
        service_name="worker", send_to_logfire="if-token-present", console=False,
    )
    sdk.instrument_system_metrics.assert_called_once()
    sdk.instrument_httpx.assert_called_once_with(
        capture_headers=False, capture_request_body=False, capture_response_body=False,
    )
    assert sdk.span.call_count == 2
    assert sdk.force_flush.call_count == 2


def test_http_requests_are_children_and_payloads_are_not_captured(monkeypatch):
    # Other entry-point tests may have initialized process-global instrumentation.
    if HTTPXClientInstrumentor().is_instrumented_by_opentelemetry:
        HTTPXClientInstrumentor().uninstrument()
    if SystemMetricsInstrumentor().is_instrumented_by_opentelemetry:
        SystemMetricsInstrumentor().uninstrument()
    exporter = SpanExporter()
    reader = InMemoryMetricReader()
    configure = logfire.configure

    def configure_offline(**kwargs):
        kwargs["send_to_logfire"] = False
        configure(
            **kwargs,
            additional_span_processors=[SimpleSpanProcessor(exporter)],
            metrics=logfire.MetricsOptions(additional_readers=[reader]),
        )

    def respond(self, request):
        return httpx.Response(200, json={"content": "private-completion"})

    monkeypatch.setattr(logfire, "configure", configure_offline)
    monkeypatch.setattr(telemetry, "_configured", False)
    # Patch the real transport before instrumentation wraps it, so no sockets open.
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", respond)
    try:
        with telemetry.telemetry_run("worker", "inference"):
            with httpx.Client() as client:
                response = client.post(
                    "https://inference.example/v1/chat/completions",
                    headers={"Authorization": "Bearer private-key"},
                    json={"messages": [{"content": "private-prompt"}]},
                )
                assert response.status_code == 200
            # The ingestion classifier uses module-level httpx.post().
            httpx.post("https://inference.example/v1/chat/completions", json={})
        spans = [
            span for span in exporter.exported_spans
            if span.attributes.get("logfire.span_type") != "pending_span"
        ]
        job = next(span for span in spans if span.name == "Modal job {job_name}")
        requests = [span for span in spans if span.attributes.get("http.method") == "POST"]
        assert len(requests) == 2
        assert all(span.parent.span_id == job.context.span_id for span in requests)
        serialized = str([dict(span.attributes) for span in spans])
        for private_value in ("private-key", "private-prompt", "private-completion"):
            assert private_value not in serialized
        assert reader.get_metrics_data() is not None
    finally:
        HTTPXClientInstrumentor().uninstrument()
        SystemMetricsInstrumentor().uninstrument()


@pytest.mark.parametrize("usage,cached", [
    ({"prompt_tokens_details": {"cached_tokens": 17}}, 17),
    ({"prompt_tokens_details": {"cached_tokens": 0}}, 0),
    ({"prompt_cache_hit_tokens": 23}, 23),
    ({}, None),
])
def test_llm_span_captures_payloads_parameters_and_usage(monkeypatch, usage, cached):
    import json

    exporter = SpanExporter()
    logfire.configure(
        send_to_logfire=False, console=False,
        additional_span_processors=[SimpleSpanProcessor(exporter)],
    )
    monkeypatch.setattr(telemetry, "_configured", True)
    request = {
        "model": "test-model", "temperature": 0.2, "max_tokens": 32000,
        "reasoning_effort": "low",
        "messages": [{"role": "system", "content": "Summarize this article."},
                     {"role": "user", "content": "The full article and comments."}],
        "response_format": {"type": "json_schema", "json_schema": {"name": "summary"}},
    }
    response = {
        "id": "completion-1", "model": "test-model",
        "choices": [{"message": {"role": "assistant", "content": "The full completion.",
                                  "reasoning_content": "Returned reasoning."},
                     "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120,
                  "completion_tokens_details": {"reasoning_tokens": 5}, **usage},
    }
    with httpx.Client(transport=httpx.MockTransport(
        lambda _: httpx.Response(200, json=response),
    )) as client:
        result = telemetry.post_chat_completion(
            client, "https://inference.example/v1/chat/completions",
            json=request, headers={"Authorization": "Bearer secret-credential"},
        )
    assert result.json() == response
    logfire.force_flush()
    span = next(span for span in exporter.exported_spans
                if span.attributes.get("logfire.span_type") == "span")
    attrs = span.attributes
    assert json.loads(attrs["request_data"]) == request
    assert json.loads(attrs["response_data"]) == response
    assert attrs["gen_ai.request.reasoning_effort"] == "low"
    assert attrs["gen_ai.usage.input_tokens"] == 100
    assert attrs["gen_ai.usage.output_tokens"] == 20
    assert attrs["gen_ai.usage.total_tokens"] == 120
    assert attrs["gen_ai.usage.reasoning_tokens"] == 5
    assert attrs.get("gen_ai.usage.cache_read.input_tokens") == cached
    assert "The full completion." in attrs["gen_ai.output.messages"]
    assert "The full article and comments." in attrs["gen_ai.input.messages"]
    assert "secret-credential" not in str(attrs)


@pytest.mark.parametrize("status,body", [(429, b'{"error":"retry later"}'), (502, b'bad gateway')])
def test_llm_telemetry_preserves_error_responses_for_caller_retries(monkeypatch, status, body):
    sdk = MagicMock()
    monkeypatch.setattr(telemetry, "logfire", sdk)
    monkeypatch.setattr(telemetry, "_configured", True)
    with httpx.Client(transport=httpx.MockTransport(
        lambda _: httpx.Response(status, content=body),
    )) as client:
        result = telemetry.post_chat_completion(
            client, "https://inference.example/v1/chat/completions",
            json={"model": "test-model", "messages": []},
        )
    assert result.status_code == status
    assert result.content == body
    sdk.span.return_value.__enter__.return_value.set_level.assert_called_once_with("error")


@pytest.fixture
def error_spans(monkeypatch):
    exporter = SpanExporter()
    logfire.configure(
        send_to_logfire=False, console=False,
        additional_span_processors=[SimpleSpanProcessor(exporter)],
    )
    monkeypatch.setattr(telemetry, "_configured", True)
    return exporter.exported_spans


def test_caught_failure_keeps_exception_and_log_in_story_trace(error_spans):
    from concurrent.futures import ThreadPoolExecutor

    @telemetry.traced_operation("ingestion_story")
    def fail(story_id):
        raise ValueError("invalid story payload")

    with (
        telemetry.operation_span("batch"),
        ThreadPoolExecutor(max_workers=1) as executor,
        pytest.raises(ValueError, match="invalid story payload"),
    ):
        executor.submit(fail, 123).result()
    spans = [s for s in error_spans if s.attributes.get("logfire.span_type") == "span"]
    batch = next(s for s in spans if s.attributes.get("operation") == "batch")
    child = next(s for s in spans if s.attributes.get("operation") == "ingestion_story")
    assert child.parent.span_id == batch.context.span_id
    assert child.attributes["story_id"] == 123
    assert child.attributes["error.type"] == "ValueError"
    assert any(event.name == "exception" for event in child.events)
    logs = [s for s in error_spans if s.attributes.get("logfire.span_type") == "log"]
    error_log = next(s for s in logs if s.attributes.get("error_type") == "ValueError")
    assert error_log.parent.span_id == child.context.span_id
    assert error_log.attributes["logfire.level_num"] == 17


def test_handled_failure_marks_span_even_when_operation_returns(error_spans):
    with telemetry.operation_span("story_enrichment", story_id=123):
        try:
            raise RuntimeError("storage unavailable")
        except RuntimeError as error:
            telemetry.report_error(error, operation="sentiment_persist", story_id=123)
    span = next(s for s in error_spans if s.attributes.get("logfire.span_type") == "span")
    assert span.attributes["logfire.level_num"] == 17
    assert any(event.name == "exception" for event in span.events)
    assert any(s.attributes.get("handled") is True and
               s.attributes.get("operation") == "sentiment_persist" for s in error_spans)


def test_application_logs_are_forwarded_once_with_trace_context(error_spans, monkeypatch):
    import logging

    logger = logging.getLogger(telemetry.LOGGER_NAME)
    monkeypatch.setattr(logger, "handlers", [])
    monkeypatch.setattr(logger, "level", logging.WARNING)
    telemetry._configure_logging()
    telemetry._configure_logging()
    with telemetry.operation_span("classification"):
        logger.warning("Retrying inference after rate limit", extra={"attempt": 2})
    matches = [s for s in error_spans
               if s.attributes.get("logfire.msg") == "Retrying inference after rate limit"]
    assert len(matches) == 1
    assert matches[0].attributes["attempt"] == 2
    parent = next(s for s in error_spans if s.attributes.get("logfire.span_type") == "span")
    assert matches[0].parent.span_id == parent.context.span_id


@pytest.mark.parametrize("failure", ["validation", "timeout"])
def test_classification_errors_have_operation_traces(error_spans, failure):
    from hn_trending.topic_filter import TitleTopicClassifier

    def respond(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("inference timed out", request=request)
        return httpx.Response(200, json={
            "choices": [{"finish_reason": "stop", "message": {"content": "{}"}}],
        })

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        classifier = TitleTopicClassifier("key", client=client)
        with pytest.raises((ValueError, httpx.ReadTimeout)):
            classifier.classify("AI model release")
    span = next(s for s in error_spans if s.attributes.get("operation") == "classification"
                and s.attributes.get("logfire.span_type") == "span")
    assert span.attributes["logfire.level_num"] == 17
    assert any(event.name == "exception" for event in span.events)
    assert any(s.parent and s.parent.span_id == span.context.span_id and
               s.attributes.get("error_type") for s in error_spans)


def test_ingestion_setup_error_is_logged_in_trace(error_spans, monkeypatch):
    from click.testing import CliRunner

    from hn_trending import cli

    def unavailable():
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(cli, "resolve_database_url", unavailable)
    result = CliRunner().invoke(cli.main, ["--limit", "1"])
    assert result.exit_code != 0
    assert any(s.attributes.get("operation") == "ingestion" and
               s.attributes.get("error_type") == "RuntimeError" for s in error_spans)
    span = next(s for s in error_spans if s.attributes.get("logfire.span_type") == "span")
    assert span.attributes["logfire.level_num"] == 17

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

from pipeline import telemetry


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

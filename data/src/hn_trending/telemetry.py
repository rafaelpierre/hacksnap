"""Logfire lifecycle for Modal jobs (one configuration per warm container)."""

from contextlib import contextmanager

import logfire

_configured = False


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
        # Keep prompts, completions, and bearer tokens out of HTTP spans.
        logfire.instrument_httpx(
            capture_headers=False, capture_request_body=False, capture_response_body=False,
        )
        _configured = True
    try:
        with logfire.span("Modal job {job_name}", job_name=job_name):
            yield
    finally:
        # Modal can suspend or stop the container as soon as the function returns.
        logfire.force_flush(timeout_millis=5000)

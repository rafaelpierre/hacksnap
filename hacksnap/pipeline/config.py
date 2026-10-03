"""Runtime configuration, loaded only when the worker runs."""

import os
from dataclasses import dataclass
from urllib.parse import quote, urlsplit

from .preprocess import DEFAULT_COMMENT_CHARS

MAX_STORIES_PER_RUN = 50
SENTIMENT_BASE_URL = "https://rafaelpierre--ep-glm-5-3-flash-nvfp4-server.us-west.modal.direct/v1"
SENTIMENT_MODEL = "nvidia/GLM-5.3-Flash-NVFP4"


def database_url_from_env() -> str:
    """Resolve database credentials without requiring inference settings."""
    database_url = os.environ.get("HACKSNAP_DATABASE_URL")
    if database_url:
        return database_url
    password = os.environ.get("SUPABASE_PASSWORD")
    if not password:
        raise ValueError("Set HACKSNAP_DATABASE_URL or SUPABASE_PASSWORD")
    return (
        "postgresql://postgres.tbihbssiluihmnseuknk:"
        f"{quote(password, safe='')}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"
        "?sslmode=require"
    )


@dataclass(frozen=True)
class Settings:
    database_url: str
    llm_base_url: str
    llm_model: str
    llm_api_key: str
    llm_reasoning_effort: str = "low"
    kestrel_binary: str = "/usr/local/bin/kestrel"
    article_chars: int = 24000
    comment_chars: int = DEFAULT_COMMENT_CHARS
    fetch_timeout: int = 30
    llm_timeout: int = 120
    sentiment_base_url: str = SENTIMENT_BASE_URL
    sentiment_model: str = SENTIMENT_MODEL
    sentiment_api_key: str | None = None
    sentiment_reasoning_effort: str = "low"

    @classmethod
    def from_env(cls) -> "Settings":
        database_url = database_url_from_env()
        required = ("MODAL_LLM_BASE_URL", "MODAL_LLM_MODEL", "MODAL_LLM_API_KEY")
        if any(not os.environ.get(key) for key in required):
            raise ValueError("Set MODAL_LLM_BASE_URL, MODAL_LLM_MODEL and MODAL_LLM_API_KEY")
        endpoint = os.environ["MODAL_LLM_BASE_URL"].rstrip("/")
        parsed = urlsplit(endpoint)
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.query:
            raise ValueError("MODAL_LLM_BASE_URL must be a credential-free HTTPS base URL")
        sentiment_endpoint = os.environ.get("MODAL_SENTIMENT_BASE_URL", SENTIMENT_BASE_URL).rstrip("/")
        parsed = urlsplit(sentiment_endpoint)
        if (parsed.scheme != "https" or not parsed.hostname or parsed.username
                or parsed.password or parsed.query or parsed.fragment):
            raise ValueError("MODAL_SENTIMENT_BASE_URL must be a credential-free HTTPS base URL")
        sentiment_model = os.environ.get("MODAL_SENTIMENT_MODEL", SENTIMENT_MODEL).strip()
        if not sentiment_model:
            raise ValueError("MODAL_SENTIMENT_MODEL must not be empty")
        return cls(
            database_url=database_url,
            llm_base_url=endpoint,
            llm_model=os.environ["MODAL_LLM_MODEL"],
            llm_api_key=os.environ["MODAL_LLM_API_KEY"],
            llm_reasoning_effort=os.environ.get("MODAL_LLM_REASONING_EFFORT", "low"),
            kestrel_binary=os.environ.get("KESTREL_BINARY", "/usr/local/bin/kestrel"),
            sentiment_base_url=sentiment_endpoint,
            sentiment_model=sentiment_model,
            sentiment_api_key=os.environ.get("MODAL_SENTIMENT_API_KEY") or os.environ["MODAL_LLM_API_KEY"],
            sentiment_reasoning_effort=os.environ.get("MODAL_SENTIMENT_REASONING_EFFORT", "low"),
        )

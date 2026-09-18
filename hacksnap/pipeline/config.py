"""Runtime configuration, loaded only when the worker runs."""

import os
from dataclasses import dataclass
from urllib.parse import quote, urlsplit


@dataclass(frozen=True)
class Settings:
    database_url: str
    llm_base_url: str
    llm_model: str
    llm_api_key: str
    llm_reasoning_effort: str = "low"
    kestrel_binary: str = "/usr/local/bin/kestrel"
    article_chars: int = 24000
    comment_chars: int = 48000
    fetch_timeout: int = 30
    llm_timeout: int = 120

    @classmethod
    def from_env(cls) -> "Settings":
        database_url = os.environ.get("HACKSNAP_DATABASE_URL")
        if not database_url:
            password = os.environ.get("SUPABASE_PASSWORD")
            if not password:
                raise ValueError("Set HACKSNAP_DATABASE_URL or SUPABASE_PASSWORD")
            database_url = (
                "postgresql://postgres.tbihbssiluihmnseuknk:"
                f"{quote(password, safe='')}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"
                "?sslmode=require"
            )
        required = ("MODAL_LLM_BASE_URL", "MODAL_LLM_MODEL", "MODAL_LLM_API_KEY")
        if any(not os.environ.get(key) for key in required):
            raise ValueError("Set MODAL_LLM_BASE_URL, MODAL_LLM_MODEL and MODAL_LLM_API_KEY")
        endpoint = os.environ["MODAL_LLM_BASE_URL"].rstrip("/")
        parsed = urlsplit(endpoint)
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.query:
            raise ValueError("MODAL_LLM_BASE_URL must be a credential-free HTTPS base URL")
        return cls(
            database_url=database_url,
            llm_base_url=endpoint,
            llm_model=os.environ["MODAL_LLM_MODEL"],
            llm_api_key=os.environ["MODAL_LLM_API_KEY"],
            llm_reasoning_effort=os.environ.get("MODAL_LLM_REASONING_EFFORT", "low"),
            kestrel_binary=os.environ.get("KESTREL_BINARY", "/usr/local/bin/kestrel"),
        )

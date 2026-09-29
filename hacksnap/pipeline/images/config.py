"""Image worker settings are independent of inference credentials."""

import os
from dataclasses import dataclass, field

from ..config import database_url_from_env
from . import ImageLimits


def env_int(name: str, default: int, minimum: int, maximum: int) -> int:
    value = int(os.environ.get(name, str(default)))
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}")
    return value


@dataclass(frozen=True)
class ImageSettings:
    database_url: str
    blob_token: str = field(repr=False)
    limits: ImageLimits = field(default_factory=ImageLimits)
    batch_size: int = 10
    max_attempts: int = 3
    stale_after_seconds: int = 900
    retry_after_seconds: int = 3600
    publisher_interval_seconds: int = 2

    @classmethod
    def from_env(cls):
        token = os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip()
        if not token:
            raise ValueError("Set BLOB_READ_WRITE_TOKEN for the image worker")
        settings = cls(
            database_url=database_url_from_env(), blob_token=token,
            limits=ImageLimits(
                max_image_bytes=env_int("HACKSNAP_IMAGE_MAX_BYTES", 10_000_000, 1, 20_000_000),
                max_html_bytes=env_int("HACKSNAP_IMAGE_HTML_MAX_BYTES", 2_000_000, 1, 5_000_000),
                max_pixels=env_int("HACKSNAP_IMAGE_MAX_PIXELS", 40_000_000, 1, 80_000_000),
                min_width=env_int("HACKSNAP_IMAGE_MIN_WIDTH", 600, 1, 1600),
                min_height=env_int("HACKSNAP_IMAGE_MIN_HEIGHT", 300, 1, 1600),
                max_dimension=env_int("HACKSNAP_IMAGE_MAX_DIMENSION", 1600, 1, 1600),
                timeout_seconds=env_int("HACKSNAP_IMAGE_TIMEOUT_SECONDS", 10, 1, 30),
                max_redirects=env_int("HACKSNAP_IMAGE_MAX_REDIRECTS", 5, 0, 10),
            ),
            batch_size=env_int("HACKSNAP_IMAGE_BATCH_SIZE", 10, 1, 100),
            max_attempts=env_int("HACKSNAP_IMAGE_MAX_ATTEMPTS", 3, 1, 10),
            stale_after_seconds=env_int("HACKSNAP_IMAGE_LEASE_SECONDS", 900, 900, 86400),
            retry_after_seconds=env_int("HACKSNAP_IMAGE_RETRY_SECONDS", 3600, 60, 604800),
            publisher_interval_seconds=env_int("HACKSNAP_IMAGE_PUBLISHER_INTERVAL", 2, 1, 60),
        )

        if settings.publisher_interval_seconds >= settings.limits.timeout_seconds:
            raise ValueError("Publisher request interval must be shorter than the fetch timeout")
        return settings

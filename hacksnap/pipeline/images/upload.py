"""Memory-only upload adapter for the pinned official Vercel Python SDK."""

import re
from urllib.parse import urlsplit

from vercel.blob import BlobClient

from . import ImageError


def canonical_blob_url(value: str) -> bool:
    try:
        url = urlsplit(value)
        return bool(
            url.scheme == "https"
            and re.fullmatch(r"[a-zA-Z0-9-]+\.public\.blob\.vercel-storage\.com", url.netloc)
            and url.path.startswith("/articles/")
            and not url.query and not url.fragment
        )
    except (ValueError, TypeError):
        return False


class BlobUploader:
    def __init__(self, token: str):
        self.token = token

    def upload(self, hn_id: int, data: bytes) -> str:
        try:
            with BlobClient(token=self.token) as client:
                result = client.put(
                    f"articles/{hn_id}/hero.webp", data,
                    access="public", content_type="image/webp", add_random_suffix=True,
                    overwrite=False, cache_control_max_age=31536000,
                )
            if not canonical_blob_url(result.url):
                raise ValueError("Unexpected Blob URL")
            return result.url
        except Exception as error:
            # Never propagate SDK diagnostics which can contain the credential or source URL.
            raise ImageError("blob_upload_failed") from error

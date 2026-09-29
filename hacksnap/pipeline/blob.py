"""Small synchronous adapter for public, immutable Vercel Blob article images."""

from urllib.parse import urlsplit


class VercelBlobStore:
    def __init__(self, token: str):
        if not token:
            raise ValueError("BLOB_READ_WRITE_TOKEN is required")
        self._token = token

    def upload_webp(self, story_id: int, image_bytes: bytes) -> str:
        """Return the actual URL, including Blob's unique cache-safe suffix."""
        if story_id <= 0 or not image_bytes:
            raise ValueError("A story ID and WebP bytes are required")
        # Import and open the client only when a Blob operation is needed.
        from vercel.blob import BlobClient

        with BlobClient(token=self._token) as client:
            blob = client.put(
                f"articles/{story_id}/hero.webp", image_bytes,
                access="public", content_type="image/webp", add_random_suffix=True,
                overwrite=False, cache_control_max_age=31536000,
            )
        url = blob.url
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or parsed.query or parsed.fragment or
                parsed.username or parsed.password or parsed.port or
                not (parsed.hostname or "").endswith(".public.blob.vercel-storage.com") or
                not parsed.path.startswith(f"/articles/{story_id}/hero-") or
                not parsed.path.endswith(".webp")):
            raise ValueError("Vercel Blob returned an unexpected public image URL")
        return url

    def delete(self, url: str) -> None:
        """Delete an orphan or superseded image after the DB write is resolved."""
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or parsed.query or parsed.fragment or
                parsed.username or parsed.password or parsed.port or
                not (parsed.hostname or "").endswith(".public.blob.vercel-storage.com") or
                not parsed.path.startswith("/articles/") or
                not parsed.path.endswith(".webp")):
            raise ValueError("Refusing to delete a non-article Blob URL")
        from vercel.blob import BlobClient

        with BlobClient(token=self._token) as client:
            client.delete(url)

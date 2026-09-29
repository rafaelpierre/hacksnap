"""Bounded discovery, retrieval, and normalization of publisher images."""

from .extract import discover_og
from .fetch import ImageError, ImageLimits, fetch_html, fetch_image
from .process import normalize_image

__all__ = [
    "ImageError",
    "ImageLimits",
    "discover_og",
    "fetch_html",
    "fetch_image",
    "normalize_image",
]

# The durable queue worker shares this package with the original publisher
# image helpers. Its canonical 1200 x 630 transform lives in worker.py, while
# normalize_image above remains available to callers of the original API.
from .worker import ImageSettings, generate_artwork, process_image_job, process_pending_images

__all__ += ["ImageSettings", "generate_artwork", "process_image_job", "process_pending_images"]

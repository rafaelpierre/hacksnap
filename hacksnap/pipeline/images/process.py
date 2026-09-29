"""Normalize decoded publisher images to a bounded, metadata-free WebP."""

import warnings
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

from .fetch import DEFAULT_LIMITS, ImageError, ImageLimits


def normalize_image(data: bytes, limits: ImageLimits = DEFAULT_LIMITS) -> tuple[bytes, int, int]:
    """Decode one frame, honor orientation, resize, and encode to WebP in memory."""
    if len(data) > limits.max_image_bytes:
        raise ImageError("image_too_large")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as source:
                width, height = source.size
                if width * height > limits.max_pixels:
                    raise ImageError("image_too_large")
                source.seek(0)
                source.load()
                oriented = ImageOps.exif_transpose(source)
                if oriented.size[0] < limits.min_width or oriented.size[1] < limits.min_height:
                    raise ImageError("image_too_small")
                oriented.thumbnail((limits.max_dimension, limits.max_dimension), Image.Resampling.LANCZOS)
                if oriented.width < limits.min_width or oriented.height < limits.min_height:
                    raise ImageError("image_too_small")
                mode = "RGBA" if "A" in oriented.getbands() or "transparency" in oriented.info else "RGB"
                result = oriented.convert(mode)
                output = BytesIO()
                result.save(output, format="WEBP", quality=82, method=4)
                return output.getvalue(), result.width, result.height
    except ImageError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ImageError("image_too_large") from exc
    except (UnidentifiedImageError, OSError, ValueError, EOFError) as exc:
        raise ImageError("decode_failed") from exc

"""Quality checks for the exact WebP bytes published to readers."""

from io import BytesIO

from PIL import Image, ImageStat, UnidentifiedImageError

from .fetch import ImageError

MIN_WEBP_BYTES = 2048


def visible_rgb(image: Image.Image) -> Image.Image:
    """Composite transparency onto the site's white background."""
    if "A" not in image.getbands() and "transparency" not in image.info:
        return image.convert("RGB")
    rgba = image.convert("RGBA")
    background = Image.new("RGBA", rgba.size, "white")
    return Image.alpha_composite(background, rgba).convert("RGB")


def validate_webp(data: bytes, size: tuple[int, int]) -> None:
    """Reject corrupt, undersized, or effectively blank encoded output."""
    try:
        with Image.open(BytesIO(data)) as image:
            if image.format != "WEBP" or image.size != size or image.n_frames != 1:
                raise ImageError("decode_failed")
            image.load()
            if len(data) < MIN_WEBP_BYTES:
                raise ImageError("image_too_few_bytes")
            # Evaluate visible RGB channels separately so colored artwork is not
            # mistaken for a flat grayscale image. Ignore invisible RGB content.
            if max(ImageStat.Stat(visible_rgb(image)).stddev) <= 1.0:
                raise ImageError("image_blank")
    except ImageError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, EOFError) as exc:
        raise ImageError("decode_failed") from exc

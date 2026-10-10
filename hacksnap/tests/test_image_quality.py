from io import BytesIO

import pytest
from PIL import Image, ImageDraw

from pipeline.image_metadata import ImageFetchError
from pipeline.images import ImageError, normalize_image
from pipeline.images.quality import MIN_WEBP_BYTES, validate_webp
from pipeline.images.worker import ImageSettings
from pipeline.images.worker import normalize_image as normalize_worker_image

SIZE = (1200, 630)


def encode(image, image_format="WEBP", **kwargs):
    output = BytesIO()
    image.save(output, format=image_format, **kwargs)
    return output.getvalue()


def artwork():
    return Image.effect_mandelbrot(SIZE, (-2, -1, 1, 1), 32).convert("RGB")


def test_realistic_output_survives_quality_checks():
    validate_webp(encode(artwork()), SIZE)


def test_tiny_but_decodable_webp_is_rejected():
    data = encode(Image.new("RGB", SIZE, "white"))
    assert len(data) < MIN_WEBP_BYTES
    with pytest.raises(ImageError, match="^image_too_few_bytes$"):
        validate_webp(data, SIZE)


@pytest.mark.parametrize("color", ["white", "black", "navy", (255, 0, 0, 0)])
def test_padding_cannot_make_blank_or_transparent_output_pass(color):
    image = Image.new("RGBA", SIZE, color)
    data = encode(image, exif=b"padding" * MIN_WEBP_BYTES)
    assert len(data) > MIN_WEBP_BYTES
    with pytest.raises(ImageError, match="^image_blank$"):
        validate_webp(data, SIZE)


def test_nearly_uniform_noise_is_rejected():
    image = Image.new("RGB", SIZE, (254, 254, 254))
    ImageDraw.Draw(image).rectangle((0, 0, 599, 629), fill="white")
    data = encode(image, lossless=True, exif=b"padding" * MIN_WEBP_BYTES)
    with pytest.raises(ImageError, match="^image_blank$"):
        validate_webp(data, SIZE)


@pytest.mark.parametrize("kind", ["empty", "html", "truncated", "wrong_format", "wrong_size"])
def test_invalid_output_is_rejected(kind):
    valid = encode(artwork())
    data = {
        "empty": b"",
        "html": b"<html>not an image</html>" * 200,
        "truncated": valid[:len(valid) // 2],
        "wrong_format": encode(artwork(), "PNG"),
        "wrong_size": encode(artwork().resize((600, 315))),
    }[kind]
    with pytest.raises(ImageError, match="^decode_failed$"):
        validate_webp(data, SIZE)


@pytest.mark.parametrize("transparent", [False, True])
def test_both_ingestion_paths_reject_visually_empty_sources(transparent):
    source = artwork().convert("RGBA") if transparent else Image.new("RGB", SIZE, "white")
    if transparent:
        source.putalpha(0)
    raw = encode(source, "PNG")
    with pytest.raises(ImageError, match="^image_(too_few_bytes|blank)$"):
        normalize_image(raw)
    with pytest.raises(ImageFetchError, match="^image_(too_few_bytes|blank)$"):
        normalize_worker_image(raw, "image/png", ImageSettings())


def test_transparent_artwork_is_composited_on_white():
    source = artwork().convert("RGBA")
    ImageDraw.Draw(source).rectangle((0, 0, 199, 629), fill=(255, 0, 0, 0))
    output = normalize_worker_image(encode(source, "PNG"), "image/png", ImageSettings())
    with Image.open(BytesIO(output)) as image:
        assert min(image.getpixel((20, 300))) >= 250


def test_crop_that_removes_all_content_is_rejected():
    source = Image.new("RGB", (1200, 1200), "white")
    source.paste(artwork().resize((1200, 100)), (0, 0))
    with pytest.raises(ImageFetchError, match="^image_too_few_bytes$"):
        normalize_worker_image(encode(source, "PNG"), "image/png", ImageSettings())

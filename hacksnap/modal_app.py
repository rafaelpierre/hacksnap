"""Deploy from hacksnap/: uv run modal deploy modal_app.py."""

from pathlib import Path

import modal

ROOT = Path(__file__).parent
KESTREL_VERSION = "10.1.0"

app = modal.App("hacksnap")

# Rust is needed only at image build time. The pinned source's lockfile pins its crates.
# primp/aws-lc need a C/C++ toolchain and CMake; Linux binaries are built in Linux.
hacksnap_image = (
    modal.Image.from_registry("rust:1.94.0-bookworm", add_python="3.12")
    .apt_install("git", "cmake", "clang", "pkg-config", "libssl-dev", "ca-certificates")
    .run_commands(
        f"cargo install kestrel-rs --version ={KESTREL_VERSION} --locked --bin kestrel --root /opt/kestrel",
        "install /opt/kestrel/bin/kestrel /usr/local/bin/kestrel",
        "rm -rf /opt/kestrel /usr/local/cargo/registry /usr/local/cargo/git",
    )
    .uv_sync(uv_project_dir=ROOT)
    .add_local_python_source("pipeline")
)

image_worker_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("fonts-noto-core", "fonts-noto-cjk", "ca-certificates")
    .uv_sync(uv_project_dir=ROOT)
    .add_local_python_source("pipeline")
)


@app.function(
    image=hacksnap_image,
    schedule=modal.Cron("0 0,9-23 * * *", timezone="Europe/London"),
    secrets=[modal.Secret.from_name("hacksnap")],
    timeout=2400,
    max_containers=1,
)
def refresh_hacksnap():
    from pipeline.refresh import run

    return run()


@app.function(
    image=image_worker_image,
    schedule=modal.Cron("*/10 * * * *", timezone="Europe/London"),
    secrets=[modal.Secret.from_name("hacksnap")],
    timeout=2400,
    max_containers=1,
)
def refresh_article_images():
    """Drain the durable image queue independently of summary generation."""
    import logging
    import os

    if os.environ.get("HACKSNAP_IMAGES_ENABLED", "").lower() != "true":
        return {"status": "disabled"}
    if not os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip():
        raise ValueError("BLOB_READ_WRITE_TOKEN is required when images are enabled")

    from pipeline.blob import VercelBlobStore
    from pipeline.config import database_url_from_env
    from pipeline.images.worker import ImageSettings, process_pending_images
    from pipeline.supabase import Repository

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    settings = ImageSettings.from_env()
    return process_pending_images(
        Repository(database_url_from_env()),
        VercelBlobStore(os.environ["BLOB_READ_WRITE_TOKEN"]),
        limit=settings.batch_size,
        settings=settings,
    )

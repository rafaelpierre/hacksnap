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
    image=hacksnap_image,
    schedule=modal.Cron("15 * * * *"),
    secrets=[modal.Secret.from_name("hacksnap")],
    timeout=900,
    max_containers=1,
)
def refresh_article_images():
    """Drain the durable image queue independently of summary generation."""
    import logging
    import os

    # Existing installations continue serving text until the public Blob store
    # is provisioned. Never require Blob credentials in the summarizer function.
    if not os.environ.get("BLOB_READ_WRITE_TOKEN", "").strip():
        logging.getLogger("hacksnap.images").info(
            '{"event":"article_images_disabled","reason":"missing_blob_token"}'
        )
        return {"status": "disabled"}
    from pipeline.images.backfill import run

    return run()

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
    schedule=modal.Cron("0 * * * *"),
    secrets=[modal.Secret.from_name("hacksnap")],
    timeout=2400,
    max_containers=1,
)
def refresh_hacksnap():
    from pipeline.refresh import run

    return run()

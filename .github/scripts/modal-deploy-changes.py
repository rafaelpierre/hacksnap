"""Select production deployments separately from the worker's broad CI trigger."""
import os
import re
import subprocess
from pathlib import Path

PRODUCTION_FILES = {
    "hacksnap/modal_app.py",
    "hacksnap/pyproject.toml",
    "hacksnap/uv.lock",
    ".github/workflows/hacksnap.yml",
    ".github/scripts/deploy-modal.sh",
    ".github/scripts/migrate-schema.sh",
    ".github/workflows/supabase-schema.yml",
    ".github/scripts/modal-deploy-changes.py",
}


def should_deploy(event: str, ref: str, before: str, after: str) -> bool:
    if event == "workflow_dispatch":
        return True
    if event != "push" or ref != "refs/heads/main":
        return False
    if not all(re.fullmatch(r"[0-9a-f]{40}", sha) for sha in (before, after)):
        raise ValueError("A main push requires valid before and after revisions")
    if before == "0" * 40:
        command = ["git", "ls-tree", "-r", "--name-only", "-z", after, "--"]
    else:
        # Include deletions and both sides of renames across every commit in the push.
        command = ["git", "diff", "--no-ext-diff", "--no-textconv", "--no-renames",
                   "--name-only", "-z", before, after, "--"]
    result = subprocess.run(command, capture_output=True, check=True, timeout=30)
    paths = [os.fsdecode(path) for path in result.stdout.split(b"\0") if path]
    return any(path.startswith("hacksnap/pipeline/") or path in PRODUCTION_FILES for path in paths)


def main() -> None:
    # A missing before commit or failed diff fails the job; it must not silently skip deployment.
    deploy = should_deploy(
        os.environ["GITHUB_EVENT_NAME"], os.environ["GITHUB_REF"],
        os.environ.get("BEFORE_SHA", ""), os.environ["GITHUB_SHA"],
    )
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        output.write(f"deploy={str(deploy).lower()}\n")
    print("Production changes require deployment." if deploy else "Worker validation only.")


if __name__ == "__main__":
    main()

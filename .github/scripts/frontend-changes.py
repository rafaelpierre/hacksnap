"""Skip browser checks only for pull requests containing known non-runtime files."""
import os
import re
import subprocess
from pathlib import Path

DOCUMENTATION = {
    "README.md",
    "AGENTS.md",
    "hacksnap/README.md",
    "hacksnap/AGENTS.md",
    "hacksnap/web/README.md",
    "hacksnap/web/lib/assets/README.md",
}


def requires_browser(event: str, base: str, head: str) -> bool:
    if event != "pull_request":
        return True
    if not all(re.fullmatch(r"[0-9a-f]{40}", sha) for sha in (base, head)):
        return True
    # Disabling rename detection includes both the removed and added paths.
    result = subprocess.run(
        ["git", "diff", "--no-ext-diff", "--no-textconv", "--no-renames",
         "--name-only", "-z", base, head, "--"],
        capture_output=True, timeout=30, check=False,
    )
    if result.returncode:
        print("Could not compare PR revisions; running all browser checks.")
        return True
    paths = [os.fsdecode(path) for path in result.stdout.split(b"\0") if path]
    return not paths or any(
        path not in DOCUMENTATION
        and not path.startswith("hacksnap/web/tests/")
        and not (path.startswith("docs/") and path.endswith(".md"))
        for path in paths
    )


def main() -> None:
    required = requires_browser(
        os.environ["GITHUB_EVENT_NAME"],
        os.environ.get("BASE_SHA", ""),
        os.environ["GITHUB_SHA"],
    )
    with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
        output.write(f"browser={str(required).lower()}\n")
    print("Full browser coverage required." if required else "Documentation/unit-test changes only.")


if __name__ == "__main__":
    main()

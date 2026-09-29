"""Execute the production deployment guard with mocked CLI commands; no network."""
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "deploy-modal.sh"
CURRENT = "a" * 40
OLDER = "b" * 40


class ModalDeployGuardTests(unittest.TestCase):
    def run_guard(self, run_sha=CURRENT, main_sha=CURRENT, gh_status=0, sync_status=0):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, source in {
                "gh": '#!/bin/sh\nprintf "gh %s\\n" "$*" >> "$CALL_LOG"\n'
                      'printf "%s\\n" "$MAIN_SHA"\nexit "$GH_STATUS"\n',
                "uv": '#!/bin/sh\nprintf "uv %s\\n" "$*" >> "$CALL_LOG"\n'
                      'if [ "$1" = sync ]; then exit "$SYNC_STATUS"; fi\n',
            }.items():
                executable = root / name
                executable.write_text(source)
                executable.chmod(0o755)
            log = root / "calls"
            summary = root / "summary"
            # An isolated environment ensures the fake commands never see credentials.
            result = subprocess.run(
                ["/bin/bash", str(SCRIPT)], cwd=root, capture_output=True, text=True,
                check=False, timeout=10,
                env={
                    "PATH": str(root), "CALL_LOG": str(log),
                    "MAIN_SHA": main_sha, "GH_STATUS": str(gh_status),
                    "SYNC_STATUS": str(sync_status), "GITHUB_SHA": run_sha,
                    "GITHUB_REPOSITORY": "example/repository", "GITHUB_STEP_SUMMARY": str(summary),
                },
            )
            return result, log.read_text().splitlines(), summary.read_text() if summary.exists() else ""

    def test_current_validated_revision_deploys_after_fresh_main_lookup(self):
        result, calls, summary = self.run_guard()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, [
            "uv sync --locked --no-dev",
            "gh api repos/example/repository/git/ref/heads/main --jq .object.sha",
            "uv run modal deploy modal_app.py",
        ])
        self.assertEqual(summary, "")

    def test_older_run_cannot_deploy_after_newer_run(self):
        newer, newer_calls, _ = self.run_guard()
        older, older_calls, summary = self.run_guard(run_sha=OLDER)
        self.assertEqual(newer.returncode, 0)
        self.assertIn("uv run modal deploy modal_app.py", newer_calls)
        self.assertEqual(older.returncode, 0)
        self.assertNotIn("uv run modal deploy modal_app.py", older_calls)
        self.assertIn("Skipping stale Modal deployment", older.stdout)
        self.assertIn(OLDER, summary)
        self.assertIn(CURRENT, summary)

    def test_failed_or_invalid_main_lookup_never_deploys(self):
        for main_sha, gh_status in [(CURRENT, 1), ("", 0), ("null", 0), ("bad-response", 0)]:
            with self.subTest(main_sha=main_sha, gh_status=gh_status):
                result, calls, _ = self.run_guard(main_sha=main_sha, gh_status=gh_status)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("uv run modal deploy modal_app.py", calls)

    def test_failed_dependency_setup_stops_before_main_lookup(self):
        result, calls, _ = self.run_guard(sync_status=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, ["uv sync --locked --no-dev"])


if __name__ == "__main__":
    unittest.main()

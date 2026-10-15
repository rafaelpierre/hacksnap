"""Verify selective browser checks against real Git diffs, including renames."""
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "frontend-changes.py"


class FrontendChangesTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.env = {"PATH": os.defpath, "GIT_CONFIG_NOSYSTEM": "1",
                    "GIT_CONFIG_GLOBAL": os.devnull}
        self.git("init", "--quiet")
        self.git("config", "maintenance.auto", "false")
        self.write("hacksnap/web/app/page.tsx", "original")
        self.before = self.commit()

    def git(self, *args):
        return subprocess.run(
            ["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
             "-c", "commit.gpgsign=false", *args],
            cwd=self.root, env=self.env, capture_output=True, text=True, check=True,
        ).stdout.strip()

    def write(self, path, content="test"):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    def commit(self):
        self.git("add", "--all")
        self.git("commit", "--quiet", "-m", "Synthetic test commit")
        return self.git("rev-parse", "HEAD")

    def assert_selection(self, expected, *, before=None, event="pull_request"):
        output = self.root / "output"
        output.unlink(missing_ok=True)
        result = subprocess.run(
            [sys.executable, str(SCRIPT)], cwd=self.root, capture_output=True, text=True,
            check=False, timeout=10,
            env={**self.env, "GITHUB_EVENT_NAME": event,
                 "BASE_SHA": self.before if before is None else before,
                 "GITHUB_SHA": self.git("rev-parse", "HEAD"), "GITHUB_OUTPUT": str(output)},
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output.read_text(), f"browser={str(expected).lower()}\n")
        output.unlink()

    def test_documentation_and_unit_tests_skip_browsers(self):
        for path in ["README.md", "hacksnap/web/README.md", "docs/testing.md",
                     "hacksnap/web/tests/theme.test.mjs", "hacksnap/web/tests/fixture.json"]:
            self.write(path)
        self.commit()
        self.assert_selection(False)

    def test_runtime_configuration_fixtures_and_unknown_files_require_browsers(self):
        for path in ["hacksnap/web/app/page.tsx", "hacksnap/web/app/globals.css",
                     "hacksnap/web/public/example.md", "hacksnap/web/lib/data.ts",
                     "hacksnap/web/e2e/browser.ts", "hacksnap/web/package-lock.json",
                     "hacksnap/web/jest.config.mjs", "hacksnap/web/next.config.ts",
                     "hacksnap/fixtures/example.json", "data/migrations/versions/new.py",
                     ".github/workflows/frontend.yml", ".github/scripts/frontend-changes.py",
                     "unknown-file"]:
            with self.subTest(path=path):
                before = self.git("rev-parse", "HEAD")
                self.write(path)
                self.commit()
                self.assert_selection(True, before=before)

    def test_runtime_change_in_earlier_pr_commit_is_not_missed(self):
        self.write("hacksnap/web/app/page.tsx", "updated")
        self.commit()
        self.write("hacksnap/web/tests/page.test.tsx")
        self.commit()
        self.assert_selection(True)

    def test_renaming_runtime_file_into_tests_still_requires_browsers(self):
        target = self.root / "hacksnap/web/tests/page.test.tsx"
        target.parent.mkdir(parents=True)
        (self.root / "hacksnap/web/app/page.tsx").rename(target)
        self.commit()
        self.assert_selection(True)

    def test_deleting_runtime_file_requires_browsers(self):
        (self.root / "hacksnap/web/app/page.tsx").unlink()
        self.commit()
        self.assert_selection(True)

    def test_deleting_unit_test_can_skip_browsers(self):
        self.write("hacksnap/web/tests/old.test.tsx")
        before = self.commit()
        (self.root / "hacksnap/web/tests/old.test.tsx").unlink()
        self.commit()
        self.assert_selection(False, before=before)

    def test_main_manual_and_reusable_runs_keep_full_coverage(self):
        self.write("hacksnap/web/README.md")
        self.commit()
        for event in ["push", "workflow_dispatch", "workflow_call"]:
            with self.subTest(event=event):
                self.assert_selection(True, event=event)

    def test_empty_diff_and_missing_history_require_browsers(self):
        self.assert_selection(True)
        for before in ["", "invalid", "f" * 40]:
            with self.subTest(before=before):
                self.assert_selection(True, before=before)

    def test_aggregate_checks_reject_failed_cancelled_and_skipped_shards(self):
        workflow = SCRIPT.parents[1] / "workflows" / "frontend.yml"
        gates = re.findall(r'run: (test "\$SHARD_RESULT" = success)', workflow.read_text())
        self.assertEqual(len(gates), 3)
        for gate in gates:
            for shards in ["success", "failure", "cancelled", "skipped", ""]:
                with self.subTest(shards=shards):
                    result = subprocess.run(
                        ["sh", "-c", gate], capture_output=True, check=False,
                        env={**self.env, "SHARD_RESULT": shards},
                    )
                    self.assertEqual(result.returncode == 0, shards == "success")


if __name__ == "__main__":
    unittest.main()

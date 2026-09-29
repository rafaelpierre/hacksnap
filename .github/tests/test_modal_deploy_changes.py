"""Exercise deployment selection against real local Git histories, without network."""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "modal-deploy-changes.py"


class DeploymentChangesTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.env = {"PATH": os.defpath, "GIT_CONFIG_NOSYSTEM": "1",
                    "GIT_CONFIG_GLOBAL": os.devnull}
        self.git("init", "--quiet")
        self.write("hacksnap/pipeline/worker.py", "original")
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

    def selection(self, after, *, before=None, event="push", ref="refs/heads/main"):
        output = self.root / "output"
        output.unlink(missing_ok=True)
        result = subprocess.run(
            [sys.executable, str(SCRIPT)], cwd=self.root, capture_output=True, text=True,
            check=False, timeout=10,
            env={**self.env, "GITHUB_EVENT_NAME": event, "GITHUB_REF": ref,
                 "BEFORE_SHA": self.before if before is None else before,
                 "GITHUB_SHA": after, "GITHUB_OUTPUT": str(output)},
        )
        return result, output.read_text() if output.exists() else ""

    def assert_selection(self, after, expected, **kwargs):
        result, output = self.selection(after, **kwargs)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(output, f"deploy={str(expected).lower()}\n")

    def test_test_docs_fixtures_and_frontend_changes_do_not_deploy(self):
        for path in ["hacksnap/tests/test_worker.py", "hacksnap/README.md",
                     "hacksnap/fixtures/example.json", "hacksnap/web/app/page.tsx",
                     ".github/tests/test_modal_deploy.py"]:
            self.write(path)
        self.assert_selection(self.commit(), False)

    def test_runtime_change_in_earlier_commit_of_push_is_not_missed(self):
        self.write("hacksnap/pipeline/worker.py", "updated")
        self.commit()
        self.write("hacksnap/tests/test_worker.py")
        self.assert_selection(self.commit(), True)

    def test_dependency_app_and_deployment_configuration_changes_deploy(self):
        for path in ["hacksnap/modal_app.py", "hacksnap/pyproject.toml", "hacksnap/uv.lock",
                     ".github/workflows/hacksnap.yml", ".github/scripts/deploy-modal.sh",
                     ".github/scripts/modal-deploy-changes.py", ".github/scripts/migrate-schema.sh",
                     ".github/workflows/supabase-schema.yml"]:
            with self.subTest(path=path):
                before = self.git("rev-parse", "HEAD")
                self.write(path)
                self.assert_selection(self.commit(), True, before=before)

    def test_renaming_runtime_file_out_of_pipeline_still_deploys(self):
        (self.root / "hacksnap/pipeline/worker.py").rename(self.root / "removed-worker.txt")
        self.assert_selection(self.commit(), True)

    def test_new_main_branch_checks_all_tracked_paths(self):
        self.assert_selection(self.before, True, before="0" * 40)

    def test_manual_runs_deploy_but_prs_and_other_branches_do_not(self):
        self.assert_selection(self.before, True, event="workflow_dispatch", before="")
        self.assert_selection(self.before, False, event="pull_request", before="")
        self.assert_selection(self.before, False, ref="refs/heads/feature")

    def test_invalid_or_unavailable_base_fails_without_deployment_output(self):
        for before in ["", "invalid", "f" * 40]:
            with self.subTest(before=before):
                result, output = self.selection(self.before, before=before)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(output, "")


if __name__ == "__main__":
    unittest.main()

"""Run the schema deployment guard with fake CLIs and no production credentials."""
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "migrate-schema.sh"
CURRENT = "a" * 40
OLDER = "b" * 40


class SchemaDeployTests(unittest.TestCase):
    def run_migration(self, *, run_sha=CURRENT, main_sha=CURRENT, gh_status=0,
                      fail_command="", password="test-only"):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, source in {
                "gh": '#!/bin/sh\nprintf "gh %s\\n" "$*" >> "$CALL_LOG"\n'
                      'printf "%s\\n" "$MAIN_SHA"\nexit "$GH_STATUS"\n',
                "uv": '#!/bin/sh\nprintf "uv %s\\n" "$*" >> "$CALL_LOG"\n'
                      'if [ "$*" = "$FAIL_COMMAND" ]; then exit 1; fi\nexit 0\n',
            }.items():
                executable = root / name
                executable.write_text(source)
                executable.chmod(0o755)
            log = root / "calls"
            result = subprocess.run(
                ["/bin/bash", str(SCRIPT)], cwd=root, capture_output=True, text=True,
                check=False, timeout=10,
                env={
                    "PATH": str(root), "CALL_LOG": str(log), "MAIN_SHA": main_sha,
                    "GH_STATUS": str(gh_status), "FAIL_COMMAND": fail_command,
                    "SUPABASE_PASSWORD": password, "GITHUB_SHA": run_sha,
                    "GITHUB_REPOSITORY": "example/repository",
                },
            )
            return result, log.read_text().splitlines() if log.exists() else []

    def test_current_main_upgrades_then_checks_revision(self):
        result, calls = self.run_migration()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(calls, [
            "gh api repos/example/repository/git/ref/heads/main --jq .object.sha",
            "uv run alembic current",
            "uv run alembic upgrade head",
            "uv run alembic current",
        ])

    def test_stale_run_fails_before_database_access(self):
        result, calls = self.run_migration(run_sha=OLDER)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(len(calls), 1)
        self.assertIn("current main revision", result.stdout)

    def test_failed_or_invalid_lookup_fails_before_database_access(self):
        for main_sha, gh_status in [(CURRENT, 1), ("", 0), ("null", 0), ("invalid", 0)]:
            with self.subTest(main_sha=main_sha, gh_status=gh_status):
                result, calls = self.run_migration(main_sha=main_sha, gh_status=gh_status)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(len(calls), 1)

    def test_missing_password_fails_before_any_command(self):
        result, calls = self.run_migration(password="")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, [])

    def test_failed_current_check_never_attempts_upgrade(self):
        result, calls = self.run_migration(fail_command="run alembic current")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls[-1], "uv run alembic current")
        self.assertNotIn("uv run alembic upgrade head", calls)

    def test_upgrade_failure_is_propagated_to_caller(self):
        result, calls = self.run_migration(fail_command="run alembic upgrade head")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls[-1], "uv run alembic upgrade head")
        self.assertEqual(calls.count("uv run alembic current"), 1)


if __name__ == "__main__":
    unittest.main()

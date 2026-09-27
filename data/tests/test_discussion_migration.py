"""Offline migration/grant checks. These do not connect to PostgreSQL."""
import importlib.util
from io import StringIO
from pathlib import Path
from unittest.mock import MagicMock

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.dialects.postgresql import JSONB

VERSIONS = Path(__file__).parents[1] / "migrations/versions"


def load_migration(filename):
    spec = importlib.util.spec_from_file_location("migration_under_test", VERSIONS / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def render(direction):
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output}
    )
    migration = load_migration("0012_discussion_analysis.py")
    with Operations.context(context):
        getattr(migration, direction)()
    return output.getvalue()


def test_additive_nullable_columns_without_defaults_backfill_or_indexes(monkeypatch):
    migration = load_migration("0012_discussion_analysis.py")
    operations = MagicMock()
    monkeypatch.setattr(migration, "op", operations)
    migration.upgrade()
    columns = {call.args[1].name: call.args[1] for call in operations.add_column.call_args_list}
    assert set(columns) == {
        "discussion_analysis", "discussion_analysis_metadata",
        "discussion_analyzed_at", "discussion_analysis_coverage",
    }
    for name, column in columns.items():
        assert column.nullable
        if name != "discussion_analysis_coverage":
            assert column.default is None and column.server_default is None
    assert isinstance(columns["discussion_analysis"].type, JSONB)
    assert isinstance(columns["discussion_analysis_metadata"].type, JSONB)
    assert columns["discussion_analyzed_at"].type.timezone
    coverage = columns["discussion_analysis_coverage"].computed
    assert str(coverage.sqltext) == "discussion_analysis_metadata -> 'coverage'"
    assert coverage.persisted
    operations.create_table.assert_not_called()
    operations.create_index.assert_not_called()
    sql = render("upgrade")
    assert not any(word in sql.upper() for word in ("UPDATE ", "INSERT ", "DELETE ", "CREATE TABLE"))
    assert migration.down_revision == "0011_categories"


def test_generated_coverage_and_column_grants_keep_provenance_private():
    sql = render("upgrade")
    grant = sql[sql.index("GRANT SELECT"):].split(";")[0]
    assert "discussion_analysis_metadata" not in grant
    assert "discussion_analysis_coverage" in grant
    assert "discussion_analyzed_at" in grant
    assert "ON hacksnap_summaries TO hacksnap_reader" in grant
    assert "FROM PUBLIC" not in grant and "TO PUBLIC" not in grant
    # Existing reader grants do not confer table-wide access or raw comment access.
    previous = load_migration("0010_web_reader_restrict_website_database_access.py")
    assert "hn_thread_contents" not in previous.READ_COLUMNS
    assert "raw_payload" not in previous.READ_COLUMNS["hn_thread_snapshots"]
    assert "source_fingerprint" not in previous.READ_COLUMNS["hacksnap_summaries"]
    # Public coverage has an explicit key allowlist; diagnostics cannot be added silently.
    assert "- ARRAY['stored_comments','included_comments','comments_truncated','selection_method']" in sql
    assert "= '{}'::jsonb" in sql
    assert "CREATE POLICY" not in sql  # Retain the existing reader policy and RLS.
    assert "DISABLE ROW LEVEL SECURITY" not in sql


def test_constraints_reject_partial_envelopes_missing_keys_and_mismatched_times(monkeypatch):
    migration = load_migration("0012_discussion_analysis.py")
    operations = MagicMock()
    monkeypatch.setattr(migration, "op", operations)
    migration.upgrade()
    checks = {call.args[0]: call.args[2] for call in operations.create_check_constraint.call_args_list}
    complete = checks["hacksnap_analysis_complete"]
    for name in ("discussion_analysis", "discussion_analysis_metadata", "discussion_analyzed_at"):
        assert f"{name} IS NULL" in complete and f"{name} IS NOT NULL" in complete
    for name in ("hacksnap_analysis_shape", "hacksnap_analysis_metadata"):
        assert checks[name].strip().endswith(") IS TRUE")  # CHECK must not accept unknown.
    assert "::timestamptz = discussion_analyzed_at" in checks["hacksnap_analysis_metadata"]
    assert "'status' = 'no_comments'" in checks["hacksnap_analysis_metadata"]
    assert "'schema_version' = '\"1\"'::jsonb" in checks["hacksnap_analysis_metadata"]
    # Rendering with the PostgreSQL dialect also catches unsupported Alembic operations.
    assert "GENERATED ALWAYS AS (discussion_analysis_metadata -> 'coverage') STORED" in render("upgrade")


def test_downgrade_revokes_public_grants_before_removing_columns():
    sql = render("downgrade")
    assert sql.index("REVOKE SELECT") < sql.index("DROP COLUMN")
    assert sql.index("DROP COLUMN discussion_analysis_coverage") < sql.index("DROP COLUMN discussion_analysis_metadata")
    assert "DROP TABLE" not in sql and "DROP ROLE" not in sql
    for name in ("hacksnap_analysis_complete", "hacksnap_analysis_shape", "hacksnap_analysis_metadata"):
        assert f"DROP CONSTRAINT {name}" in sql

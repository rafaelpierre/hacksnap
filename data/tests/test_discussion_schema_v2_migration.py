"""The v2 constraint migration admits themes without weakening historical v1 rows."""

import json
import os
import re
import subprocess
from io import StringIO
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from test_discussion_migration import load_migration

FIXTURES = Path(__file__).parents[2] / "hacksnap/fixtures/discussion-analysis"


def render(filename: str, direction: str) -> str:
    output = StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output}
    )
    with Operations.context(context):
        getattr(load_migration(filename), direction)()
    return output.getvalue()


def test_v2_migration_replaces_only_versioned_checks():
    migration = load_migration("0018_discussion_themes_schema.py")
    assert migration.down_revision == "0017_archive_order"
    upgrade = render("0018_discussion_themes_schema.py", "upgrade")
    downgrade = render("0018_discussion_themes_schema.py", "downgrade")
    for name in ("hacksnap_analysis_shape", "hacksnap_analysis_metadata"):
        assert upgrade.count(f"DROP CONSTRAINT {name}") == 1
        assert upgrade.count(f"ADD CONSTRAINT {name} CHECK") == 1
        assert downgrade.count(f"DROP CONSTRAINT {name}") == 1
        assert downgrade.count(f"ADD CONSTRAINT {name} CHECK") == 1
    assert "'\"2\"'::jsonb" in upgrade
    assert "'\"2\"'::jsonb" not in downgrade
    assert "discussion_analysis -> 'reference_claims' = '[]'::jsonb" in upgrade
    assert "discussion_analysis -> 'critical_comments' = '[]'::jsonb" in upgrade
    assert "discussion_analysis -> 'supportive_comments' = '[]'::jsonb" in upgrade
    assert "Cannot downgrade discussion analysis while v2 rows exist" in downgrade
    original = render("0012_discussion_analysis.py", "upgrade")
    for name in ("hacksnap_analysis_shape", "hacksnap_analysis_metadata"):
        start = f"ADD CONSTRAINT {name} CHECK ("
        old_check = original[original.index(start) :].split(";", 1)[0]
        restored_check = downgrade[downgrade.index(start) :].split(";", 1)[0]
        assert re.sub(r"\s+", " ", restored_check) == re.sub(r"\s+", " ", old_check)
    for sql in (upgrade, downgrade):
        assert not re.search(r"\b(UPDATE|INSERT|DELETE|CREATE TABLE|DROP TABLE)\b", sql)
        assert "GRANT " not in sql and "REVOKE " not in sql
        assert "hacksnap_analysis_complete" not in sql


@pytest.mark.skipif(
    not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"), reason="optional PGlite runtime"
)
def test_postgres_accepts_v2_new_and_refreshed_rows_but_preserves_v1_rules():
    fixtures = json.loads((FIXTURES / "valid.json").read_text())
    v1_analysis = fixtures[0]["expected"]
    v1_metadata = json.loads((FIXTURES / "metadata.json").read_text())
    v2_analysis = {
        "status": "available",
        "reference_claims": [],
        "critical_comments": [],
        "supportive_comments": [],
        "topics": v1_analysis["topics"],
    }
    v2_metadata = {**v1_metadata, "schema_version": "2"}
    no_comments = {**v2_analysis, "status": "no_comments", "topics": []}
    no_comments_metadata = {
        **v2_metadata,
        "coverage": {
            **v1_metadata["coverage"],
            "stored_comments": 0,
            "included_comments": 0,
            "comments_truncated": False,
        },
    }
    script = r"""
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const input = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();
const timestamp = '2026-09-27T12:00:00Z';
const insert = (id, analysis, metadata) => db.query(
  'INSERT INTO hacksnap_summaries (story_id,discussion_analysis,discussion_analysis_metadata,discussion_analyzed_at) VALUES ($1,$2::jsonb,$3::jsonb,$4::timestamptz)',
  [id, JSON.stringify(analysis), JSON.stringify(metadata), timestamp]);
try {
  await db.exec('CREATE ROLE hacksnap_reader; CREATE TABLE hacksnap_summaries (story_id bigint PRIMARY KEY)');
  await db.exec(input.initial);
  await insert(1, input.v1Analysis, input.v1Metadata);
  await assert.rejects(insert(2, input.v2Analysis, input.v2Metadata), /hacksnap_analysis_shape|hacksnap_analysis_metadata/);
  await assert.rejects(insert(3, input.noComments, input.noCommentsMetadata), /hacksnap_analysis_metadata/);
  await db.exec(input.upgrade);
  await insert(2, input.v2Analysis, input.v2Metadata);
  await insert(3, input.noComments, input.noCommentsMetadata);
  await db.query(
    'UPDATE hacksnap_summaries SET discussion_analysis=$1::jsonb, discussion_analysis_metadata=$2::jsonb WHERE story_id=1',
    [JSON.stringify(input.v2Analysis), JSON.stringify(input.v2Metadata)]);
  assert.deepEqual((await db.query('SELECT story_id FROM hacksnap_summaries ORDER BY story_id')).rows.map(r => Number(r.story_id)), [1,2,3]);
  assert.equal((await db.query("SELECT discussion_analysis_coverage ->> 'included_comments' AS count FROM hacksnap_summaries WHERE story_id=3")).rows[0].count, '0');
  await assert.rejects(insert(4, {...input.v2Analysis, status: 'insufficient_context'}, input.v2Metadata), /hacksnap_analysis_shape/);
  await assert.rejects(insert(4, {...input.v2Analysis, critical_comments: input.v1Analysis.critical_comments}, input.v2Metadata), /hacksnap_analysis_shape/);
  await assert.rejects(insert(4, input.v2Analysis, {...input.v2Metadata, schema_version: '3'}), /hacksnap_analysis_metadata/);
  await assert.rejects(insert(4, input.v2Analysis, input.v1Metadata), /hacksnap_analysis_shape/);
  await insert(4, input.v1Analysis, input.v1Metadata);
  await assert.rejects(db.exec(input.downgrade), /Cannot downgrade discussion analysis while v2 rows exist/);
  await db.query('DELETE FROM hacksnap_summaries WHERE story_id <> 4');
  await db.exec(input.downgrade);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM hacksnap_summaries')).rows[0].count, 1);
  await assert.rejects(insert(5, input.v2Analysis, input.v2Metadata), /hacksnap_analysis_shape|hacksnap_analysis_metadata/);
} finally { await db.close(); }
"""
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script],
        capture_output=True,
        text=True,
        check=False,
        input=json.dumps(
            {
                "initial": render("0012_discussion_analysis.py", "upgrade"),
                "upgrade": render("0018_discussion_themes_schema.py", "upgrade"),
                "downgrade": render("0018_discussion_themes_schema.py", "downgrade"),
                "v1Analysis": v1_analysis,
                "v1Metadata": v1_metadata,
                "v2Analysis": v2_analysis,
                "v2Metadata": v2_metadata,
                "noComments": no_comments,
                "noCommentsMetadata": no_comments_metadata,
            }
        ),
    )
    assert result.returncode == 0, result.stderr

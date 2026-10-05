from copy import deepcopy
from datetime import datetime, timezone
from io import StringIO
import json
import os
from pathlib import Path
import subprocess

from alembic.migration import MigrationContext
from alembic.operations import Operations
from click.testing import CliRunner
import pytest

from hn_trending import import_story_views as importer
from test_discussion_migration import load_migration

SEED = Path(__file__).parents[1] / "seeds/story-page-views-2026-10-05.csv"
CUTOFF = datetime(2026, 1, 1, tzinfo=timezone.utc)
FIRST_VIEW = datetime(2026, 1, 2, tzinfo=timezone.utc)


def snapshot_file(tmp_path, content):
    path = tmp_path / "views.csv"
    path.write_text(content)
    return path


def test_supplied_seed_only_contains_six_story_pages():
    snapshot = importer.read_import(SEED)
    assert snapshot.totals == {49802871: 322, 49849985: 20, 49849820: 18,
                               49765348: 12, 49891290: 12, 49771110: 8}
    assert sum(snapshot.totals.values()) == 392


@pytest.mark.parametrize("path", ["/", "/archive", "/category/agents-coding", "/seen-preview",
    "https://evil.example/story/123", "//evil.example/story/123",
    "https://hacksnap.live.evil.example/story/123", "https://hacksnap.live:443/story/123",
    "/story/0", "/story/01", "/story/123/extra", "/story/a_123", "/story/123 ",
    "/story/" + "a" * 93 + "-123", "/story/1000000000000000"])
def test_nonstory_and_invalid_paths_are_rejected(tmp_path, path):
    with pytest.raises(ValueError):
        importer.read_import(snapshot_file(tmp_path, f"path,views\n{path},12\n"))


@pytest.mark.parametrize("views", ["0", "-1", "1.0", "1 (0.1%)", " 12", "1e3", "",
    "9223372036854775808", "9" * 100])
def test_views_are_exact_bounded_positive_integers(tmp_path, views):
    with pytest.raises(ValueError):
        importer.read_import(snapshot_file(tmp_path, f"story_id,views\n123,{views}\n"))


@pytest.mark.parametrize("content", ["path,count\n/story/123,1\n", "path,views\n",
    "path,views\n/story/123\n", "path,views\n/story/123,1,2\n",
    "path,views\n/story/123,1\nhttps://hacksnap.live/story/123,2\n"])
def test_malformed_and_duplicate_rows_are_rejected(tmp_path, content):
    with pytest.raises(ValueError):
        importer.read_import(snapshot_file(tmp_path, content))


def test_numeric_and_slug_aliases_merge_and_explain_the_merge(tmp_path):
    path = snapshot_file(tmp_path, "path,views\n/story/123,5\nhttps://hacksnap.live/story/hello-123?ref=hn,7\n")
    assert importer.read_import(path).totals == {123: 12}
    result = CliRunner().invoke(importer.main, [str(path)])
    assert result.exit_code == 0
    assert "123\t12 [merged 2 source paths]" in result.output


def test_merged_total_is_bounded(tmp_path):
    with pytest.raises(ValueError, match="bigint"):
        importer.read_import(snapshot_file(tmp_path,
            f"path,views\n/story/123,{importer.MAX_BIGINT}\n/story/hello-123,1\n"))


def test_default_dryrun_never_connects(monkeypatch):
    monkeypatch.setenv("HACKSNAP_IMPORT_DATABASE_URL", "postgresql://secret-password")
    monkeypatch.setattr(importer.psycopg, "connect", lambda *args, **kwargs: pytest.fail("Connected in dry run"))
    result = CliRunner().invoke(importer.main, [str(SEED)])
    assert result.exit_code == 0
    assert "6 stories; 392 historical views; source=ga_page_views" in result.output
    assert "stored IDs and slugs have not been checked" in result.output
    assert "secret-password" not in result.output


def test_apply_requires_separate_import_connection(monkeypatch):
    monkeypatch.delenv("HACKSNAP_IMPORT_DATABASE_URL", raising=False)
    monkeypatch.setenv("SUPABASE_PASSWORD", "not-a-fallback")
    result = CliRunner().invoke(importer.main, [str(SEED), "--apply"])
    assert result.exit_code == 2
    assert "Set HACKSNAP_IMPORT_DATABASE_URL" in result.output


@pytest.mark.parametrize("value", ["2026-01-01", "2026-01-01T00:00:00", "invalid", "2999-01-01T00:00:00Z"])
def test_cutoff_requires_real_aware_timestamp(value):
    with pytest.raises(ValueError):
        importer.parse_through(value)


def test_cutoff_normalizes_timezone():
    assert importer.parse_through("2026-01-01T01:00:00+01:00") == CUTOFF


class FakeDatabase:
    def __init__(self, monkeypatch):
        self.stories = {123: "hello-123", 456: None}
        self.popularity = {}
        self.first_view = None
        self.queries = []
        self.rollbacks = 0
        self.writes = 0
        self.connect_options = {}
        monkeypatch.setattr(importer.psycopg, "connect", self.connect)

    def connect(self, url, **kwargs):
        self.connect_options = kwargs
        return self

    def __enter__(self):
        self.before = deepcopy(self.popularity)
        return self

    def __exit__(self, error, *_):
        if error:
            self.popularity = self.before
            self.rollbacks += 1

    def cursor(self):
        database = self

        class Cursor:
            def __enter__(self): return self
            def __exit__(self, *_): pass

            def execute(self, query, params=None):
                database.queries.append(query)
                if query.startswith("SELECT hn_id"):
                    self.results = [{"hn_id": key, "story_slug": database.stories[key]}
                                    for key in params[0] if key in database.stories]
                elif query.startswith("SELECT story_id"):
                    self.results = [database.popularity[key] for key in params[0]
                                    if key in database.popularity]
                elif query.startswith("SELECT MIN"):
                    self.results = [{"first_event": database.first_view}]
                elif query.startswith("SELECT EXISTS"):
                    self.results = [{"has_views": any(row["story_views"] > 0
                                                      for row in database.popularity.values())}]

            def fetchall(self): return self.results
            def fetchone(self): return self.results[0]

            def executemany(self, query, rows):
                # Assert the importer updates historical fields only. Production
                # counters must survive even when the baseline is corrected.
                updates = query.split("DO UPDATE SET")[1]
                assert "story_views" not in updates
                assert "story_clicks" not in updates
                for story_id, views, source, through in rows:
                    old = database.popularity.setdefault(story_id, {
                        "story_id": story_id, "story_views": 0, "story_clicks": 0})
                    old.update(historical_views=views, historical_source=source,
                               historical_through=through)
                    database.writes += 1
        return Cursor()


@pytest.fixture
def database(monkeypatch):
    return FakeDatabase(monkeypatch)


def one_story(tmp_path, views=12):
    return importer.read_import(snapshot_file(tmp_path, f"story_id,views\n123,{views}\n"))


def apply(snapshot, through=None):
    return importer.apply_import("postgresql://localhost/test", snapshot, through)


def test_import_replaces_baseline_idempotently_and_uses_tls(database, tmp_path):
    snapshot = one_story(tmp_path)
    assert apply(snapshot) == 1
    assert apply(snapshot) == 0
    assert database.writes == 1
    assert database.popularity[123]["historical_views"] == 12
    assert database.connect_options["sslmode"] == "require"
    assert apply(one_story(tmp_path, 20)) == 1
    assert database.popularity[123]["historical_views"] == 20


def test_unknown_story_fails_whole_import_before_any_write(database, tmp_path):
    snapshot = importer.read_import(snapshot_file(tmp_path, "story_id,views\n123,12\n999,4\n"))
    with pytest.raises(ValueError, match="Unknown stored story IDs: 999"):
        apply(snapshot)
    assert database.writes == 0
    assert database.rollbacks == 1
    assert database.popularity == {}


def test_slug_must_match_stored_slug(database, tmp_path):
    snapshot = importer.read_import(snapshot_file(tmp_path, "path,views\n/story/fake-123,12\n"))
    with pytest.raises(ValueError, match="stored canonical slug"):
        apply(snapshot)
    assert database.writes == 0


def test_live_tracking_needs_cutoff_and_rejects_overlap(database, tmp_path):
    database.first_view = FIRST_VIEW
    snapshot = one_story(tmp_path)
    with pytest.raises(ValueError, match="specify the actual GA"):
        apply(snapshot)
    with pytest.raises(ValueError, match="overlaps"):
        apply(snapshot, datetime(2026, 1, 3, tzinfo=timezone.utc))
    assert database.writes == 0
    assert apply(snapshot, CUTOFF) == 1


def test_preserves_live_counters_and_immutable_cutoff(database, tmp_path):
    apply(one_story(tmp_path), CUTOFF)
    database.popularity[123].update(story_views=8, story_clicks=3)
    database.first_view = FIRST_VIEW
    assert apply(one_story(tmp_path, 20), CUTOFF) == 1
    assert database.popularity[123]["historical_views"] == 20
    assert database.popularity[123]["story_views"] == 8
    assert database.popularity[123]["story_clicks"] == 3
    with pytest.raises(ValueError, match="established baseline cutoff"):
        apply(one_story(tmp_path, 22), datetime(2025, 12, 31, tzinfo=timezone.utc))


def test_exact_reapply_without_cutoff_remains_safe_after_activation(database, tmp_path):
    snapshot = one_story(tmp_path)
    apply(snapshot)
    database.popularity[123]["story_views"] = 8
    database.first_view = FIRST_VIEW
    assert apply(snapshot) == 0
    with pytest.raises(ValueError, match="specify the actual GA"):
        apply(one_story(tmp_path, 15))


def test_missing_receipts_refuse_unverifiable_cutoff(database, tmp_path):
    apply(one_story(tmp_path), CUTOFF)
    database.popularity[123]["story_views"] = 8
    with pytest.raises(ValueError, match="without event receipts"):
        apply(one_story(tmp_path, 20), CUTOFF)


def test_other_historical_source_is_not_overwritten(database, tmp_path):
    apply(one_story(tmp_path))
    database.popularity[123]["historical_source"] = "other-source"
    with pytest.raises(ValueError, match="different historical source"):
        apply(one_story(tmp_path, 20))


def test_tls_cannot_be_disabled(database, tmp_path):
    with pytest.raises(ValueError, match="require TLS"):
        importer.apply_import("postgresql://localhost/test?sslmode=disable", one_story(tmp_path), None)
    assert database.writes == 0


def test_supabase_tls_verifies_hostname_with_bundled_ca(database, tmp_path):
    importer.apply_import("postgresql://aws-1-eu-west-1.pooler.supabase.com/test?sslmode=require",
                          one_story(tmp_path), None)
    assert database.connect_options["sslmode"] == "verify-full"
    assert Path(database.connect_options["sslrootcert"]).name == "supabase-ca.crt"


def test_supabase_tls_preserves_explicit_ca(database, tmp_path):
    custom_ca = tmp_path / "custom.crt"
    custom_ca.write_text("test-only")
    importer.apply_import(f"postgresql://db.example.supabase.co/test?sslrootcert={custom_ca}",
                          one_story(tmp_path), None)
    assert database.connect_options["sslrootcert"] == str(custom_ca)
    assert database.connect_options["sslmode"] == "verify-full"


def test_database_failure_does_not_log_credentials(monkeypatch):
    monkeypatch.setenv("HACKSNAP_IMPORT_DATABASE_URL", "postgresql://localhost/test")
    def fail(*args, **kwargs):
        raise importer.psycopg.OperationalError("password=secret-and-private")
    monkeypatch.setattr(importer.psycopg, "connect", fail)
    result = CliRunner().invoke(importer.main, [str(SEED), "--apply"])
    assert result.exit_code == 1
    assert "no changes committed" in result.output
    assert "secret-and-private" not in result.output


@pytest.mark.skipif(not os.environ.get("HACKSNAP_TEST_PGLITE_MODULE"), reason="optional PGlite runtime")
def test_real_postgres_baseline_replacement_preserves_live_counts_and_rolls_back():
    output = StringIO()
    context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output})
    with Operations.context(context):
        load_migration("0019_story_popularity.py").upgrade()
    # Translate positional psycopg placeholders for the embedded PG driver.
    query = importer.UPSERT
    for index in range(1, 5):
        query = query.replace("%s", f"${index}", 1)
    script = r'''
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { PGlite } = await import(process.env.HACKSNAP_TEST_PGLITE_MODULE);
const input = JSON.parse(readFileSync(0, 'utf8'));
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE hacksnap_reader;
    CREATE TABLE hacker_news_threads (hn_id bigint PRIMARY KEY, date_added timestamptz);
    INSERT INTO hacker_news_threads VALUES (123,'2026-01-01');`);
  await db.exec(input.migration);
  await db.query(input.query, [123,12,'ga_page_views','2026-01-01T00:00:00Z']);
  await db.exec('UPDATE hacksnap_story_popularity SET story_views=8,story_clicks=3 WHERE story_id=123');
  await db.query(input.query, [123,20,'ga_page_views','2026-01-01T00:00:00Z']);
  const row = (await db.query('SELECT * FROM hacksnap_story_popularity')).rows[0];
  assert.equal(Number(row.historical_views),20);
  assert.equal(Number(row.story_views),8);
  assert.equal(Number(row.story_clicks),3);
  await db.query(input.query, [123,'9223372036854775807','ga_page_views',null]);
  assert.equal((await db.query('SELECT (historical_views::numeric + story_views::numeric)::text AS total FROM hacksnap_story_popularity')).rows[0].total,'9223372036854775815');
  await db.query(input.query, [123,20,'ga_page_views','2026-01-01T00:00:00Z']);
  await db.exec('BEGIN');
  await db.exec(`LOCK TABLE hacksnap_popularity_events,hacksnap_story_popularity IN SHARE ROW EXCLUSIVE MODE`);
  await db.query(input.query, [123,22,'ga_page_views',null]);
  await assert.rejects(db.query(input.query, [999,4,'ga_page_views',null]), /foreign key/);
  await db.exec('ROLLBACK');
  assert.equal(Number((await db.query('SELECT historical_views FROM hacksnap_story_popularity')).rows[0].historical_views),20);
} finally { await db.close(); }
'''
    result = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True,
                            input=json.dumps({"migration": output.getvalue(), "query": query}))
    assert result.returncode == 0, result.stderr

"""Repository contract tests with mocked PostgreSQL connections; no database needed."""
import json
from pathlib import Path
from unittest.mock import MagicMock

import psycopg
import pytest

from pipeline.models import DiscussionAnalysis, DiscussionAnalysisMetadata, StorySummary
from pipeline.supabase import Repository

FIXTURES = Path(__file__).parents[1] / "fixtures/discussion-analysis"
VALID = json.loads((FIXTURES / "valid.json").read_text())


def pair(fixture=None):
    fixture = fixture or VALID[0]
    analysis = DiscussionAnalysis.model_validate(fixture["expected"])
    metadata = DiscussionAnalysisMetadata.model_validate_json((FIXTURES / "metadata.json").read_text())
    count = len(fixture["inputs"]["comments"])
    metadata.coverage.stored_comments = count
    metadata.coverage.included_comments = count
    metadata.coverage.comments_truncated = False
    analysis.validate_sources(**fixture["inputs"])
    metadata.validate_analysis(analysis, fixture["inputs"]["comments"])
    return analysis, metadata


@pytest.fixture
def database(monkeypatch):
    connect = MagicMock()
    connection = connect.return_value.__enter__.return_value
    connection.execute.return_value.rowcount = 1
    monkeypatch.setattr("pipeline.supabase.psycopg.connect", connect)
    return Repository("postgresql://mock.invalid/test"), connect, connection


def save(repo, analysis=None, metadata=None):
    repo.save_summary(
        200, "https://example.com", StorySummary(
            article_summary="Article", article_key_points=["Claim"],
            discussion_summary="Discussion", discussion_points=[], sentiment=0,
            overall_takeaway="Takeaway",
            discussion_analysis=analysis or pair()[0],
        ), "c" * 64, "test", "v1", {"included_comments": 1},
        discussion_analysis=analysis, discussion_analysis_metadata=metadata,
    )


@pytest.mark.parametrize("fixture", VALID, ids=lambda fixture: fixture["id"])
def test_serialized_contract_round_trip_in_one_statement(database, fixture):
    repo, connect, connection = database
    analysis, metadata = pair(fixture)
    save(repo, analysis, metadata)
    connection.execute.assert_called_once()
    sql, record = connection.execute.call_args.args
    assert "INSERT INTO hacksnap_summaries" in sql
    for column in ("discussion_analysis", "discussion_analysis_metadata", "discussion_analyzed_at"):
        assert f"{column} = EXCLUDED.{column}" in sql
    # Exercise the actual JSON payload passed to psycopg, including reference claims.
    persisted = {
        "discussion_analysis": json.loads(json.dumps(record["discussion_analysis"].obj)),
        "discussion_analysis_metadata": json.loads(json.dumps(record["discussion_analysis_metadata"].obj)),
        "discussion_analyzed_at": record["discussion_analyzed_at"],
        "discussion_analysis_coverage": metadata.coverage.model_dump(),
    }
    assert persisted["discussion_analysis"] == fixture["expected"]
    assert persisted["discussion_analysis_metadata"] == metadata.model_dump(mode="json")
    assert persisted["discussion_analyzed_at"] == metadata.analyzed_at
    connect.return_value.__exit__.assert_called_once_with(None, None, None)
    connection.execute.reset_mock()
    connection.execute.return_value.fetchone.return_value = persisted
    assert repo.get_discussion_analysis(200) == persisted
    connection.execute.assert_called_once()
    sql, params = connection.execute.call_args.args
    assert params == (200,)
    assert "AND discussion_analysis IS NOT NULL" in sql
    assert all(column in sql for column in persisted)


def test_refresh_updates_complete_analysis_without_legacy_fields(database):
    repo, _, connection = database
    analysis, metadata = pair()
    assert repo.save_discussion_analysis(200, analysis, metadata)
    connection.execute.assert_called_once()
    sql, params = connection.execute.call_args.args
    assert params["story_id"] == 200
    assert params["discussion_analyzed_at"] == metadata.analyzed_at
    assert params["discussion_analysis"].obj == analysis.model_dump(mode="json")
    assert params["discussion_analysis_metadata"].obj == metadata.model_dump(mode="json")
    assert "WHERE story_id = %(story_id)s AND discussion_analysis IS NOT NULL" in sql
    assert all(field not in sql for field in ("sentiment", "article_summary", "summarized_content_hash", "generated_at"))


def test_refresh_does_not_create_or_backfill_rows(database):
    repo, _, connection = database
    connection.execute.return_value.rowcount = 0
    assert not repo.save_discussion_analysis(200, *pair())
    assert "INSERT" not in connection.execute.call_args.args[0]
    connection.execute.return_value.fetchone.return_value = None
    assert repo.get_discussion_analysis(200) is None


def test_initial_save_cannot_backfill_a_legacy_summary(database):
    repo, connect, connection = database
    connection.execute.return_value.rowcount = 0
    with pytest.raises(ValueError, match="legacy summary"):
        save(repo, *pair())
    sql = connection.execute.call_args.args[0]
    assert "WHERE EXCLUDED.discussion_analysis IS NULL" in sql
    assert "OR hacksnap_summaries.discussion_analysis IS NOT NULL" in sql
    assert connect.return_value.__exit__.call_args.args[0] is ValueError


@pytest.mark.parametrize("method", ["initial", "refresh"])
def test_database_failure_exits_transaction_with_error_without_retry(database, method):
    repo, connect, connection = database
    error = psycopg.errors.CheckViolation("Simulated constraint rejection")
    connection.execute.side_effect = error
    analysis, metadata = pair()
    with pytest.raises(psycopg.errors.CheckViolation):
        if method == "initial":
            save(repo, analysis, metadata)
        else:
            repo.save_discussion_analysis(200, analysis, metadata)
    connection.execute.assert_called_once()
    # psycopg's context manager receives the failure and is responsible for rollback.
    args = connect.return_value.__exit__.call_args.args
    assert args[0] is type(error) and args[1] is error


@pytest.mark.parametrize("missing", ["analysis", "metadata"])
def test_partial_analysis_is_rejected_before_connecting(database, missing):
    repo, connect, _ = database
    analysis, metadata = pair()
    with pytest.raises(ValueError, match="together"):
        save(repo, None if missing == "analysis" else analysis,
             None if missing == "metadata" else metadata)
    connect.assert_not_called()


@pytest.mark.parametrize("mutation, message", [
    (lambda a, m: setattr(a.critical_comments[0], "claim_id", "unknown"), "unknown claim"),
    (lambda a, m: setattr(a.critical_comments[0], "stance", "agrees"), "Input should be"),
    (lambda a, m: a.critical_comments.append(a.critical_comments[0]), "duplicate highlights"),
    (lambda a, m: setattr(m, "input_fingerprint", "invalid"), "pattern"),
    (lambda a, m: setattr(m.coverage, "stored_comments", 0), "exceed"),
    (lambda a, m: setattr(m.coverage, "comments_truncated", True), "Truncation"),
])
def test_mutated_models_are_revalidated_before_connecting(database, mutation, message):
    repo, connect, _ = database
    analysis, metadata = pair()
    mutation(analysis, metadata)
    with pytest.raises(ValueError, match=message):
        repo.save_discussion_analysis(200, analysis, metadata)
    connect.assert_not_called()


def test_status_and_coverage_must_agree(database):
    repo, connect, _ = database
    analysis, metadata = pair()
    metadata.coverage.stored_comments = metadata.coverage.included_comments = 0
    with pytest.raises(ValueError, match="status disagrees with coverage"):
        save(repo, analysis, metadata)
    connect.assert_not_called()


def test_distinct_citations_cannot_exceed_input_count(database):
    repo, connect, _ = database
    analysis, metadata = pair()
    analysis.topics[0].comment_ids.append(102)
    with pytest.raises(ValueError, match="more comments"):
        save(repo, analysis, metadata)
    connect.assert_not_called()


def test_legacy_summary_and_sentiment_calls_remain_compatible(database):
    repo, _, connection = database
    save(repo)
    sql, record = connection.execute.call_args.args
    # Replacing an article via the legacy path clears all old source-bound claims.
    for field in ("discussion_analysis", "discussion_analysis_metadata", "discussion_analyzed_at"):
        assert record[field] is None
        assert f"{field} = EXCLUDED.{field}" in sql
    assert record["sentiment"] == 0
    assert record["source_coverage"].obj == {"included_comments": 1}
    repo.save_sentiment(200, -1, {"included_comments": 10})
    sql, params = connection.execute.call_args.args
    assert "discussion_analysis" not in sql
    assert "source_coverage = source_coverage ||" in sql
    assert params[0] == -1 and params[2] == 200
    assert params[1].obj == {"sentiment": {"included_comments": 10}}


def test_refresh_atomically_acknowledges_input_and_checks_previous_analysis(database):
    repo, _, connection = database
    assert repo.save_discussion_analysis(200, *pair(), content_hash="d" * 64,
                                         expected_fingerprint="a" * 64)
    sql, record = connection.execute.call_args.args
    assert record["content_hash"] == "d" * 64
    assert record["expected_fingerprint"] == "a" * 64
    assert "discussion_analysis_metadata->>'input_fingerprint' = %(expected_fingerprint)s" in sql
    assert "discussion_content_hash = %(content_hash)s" in sql
    assert "source_coverage" not in sql
    assert "summarized_content_hash" not in sql and "generated_at" not in sql


def test_cache_acknowledgement_does_not_advance_discussion_or_article_time(database):
    repo, _, connection = database
    repo.mark_discussion_contents(200, "a" * 64, "b" * 64)
    sql, params = connection.execute.call_args.args
    assert params[0] == "b" * 64
    assert params[1:] == (200, "a" * 64)
    assert all(field not in sql for field in (
        "discussion_analyzed_at", "generated_at", "updated_at", "summarized_content_hash"
    ))
    connection.execute.return_value.rowcount = 0
    with pytest.raises(ValueError, match="changed during cache"):
        repo.mark_discussion_contents(200, "a" * 64, "b" * 64)

"""Use the same TLS PostgreSQL connection pattern as the existing collector."""

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .models import DiscussionAnalysis, DiscussionAnalysisMetadata, StorySummary


def _discussion_record(
    analysis: DiscussionAnalysis | None, metadata: DiscussionAnalysisMetadata | None
) -> dict:
    """Revalidate at the storage boundary, including models mutated after construction.

    Source membership must already have been checked against the prepared inputs via
    validate_sources() and validate_analysis(); raw source text is not persisted here.
    """
    if (analysis is None) != (metadata is None):
        raise ValueError("Discussion analysis and metadata must be supplied together")
    if analysis is None:
        return {
            "discussion_analysis": None,
            "discussion_analysis_metadata": None,
            "discussion_analyzed_at": None,
        }
    analysis = DiscussionAnalysis.model_validate_json(analysis.model_dump_json())
    metadata = DiscussionAnalysisMetadata.model_validate_json(metadata.model_dump_json())
    included = metadata.coverage.included_comments
    if (analysis.status == "no_comments") != (included == 0):
        raise ValueError("Analysis status disagrees with coverage")
    cited = {h.comment_id for h in [*analysis.critical_comments, *analysis.supportive_comments]}
    cited.update(cid for topic in analysis.topics for cid in topic.comment_ids)
    if len(cited) > included:
        raise ValueError("Analysis cites more comments than coverage includes")
    return {
        "discussion_analysis": Jsonb(analysis.model_dump(mode="json")),
        "discussion_analysis_metadata": Jsonb(metadata.model_dump(mode="json")),
        "discussion_analyzed_at": metadata.analyzed_at,
    }


class Repository:
    def __init__(self, database_url: str):
        self.database_url = database_url

    def _connect(self):
        return psycopg.connect(
            self.database_url,
            row_factory=dict_row,
            connect_timeout=10,
            options="-c statement_timeout=15000",
        )

    def get_current_top_stories(self, limit: int = 10) -> list[dict]:
        if not 1 <= limit <= 10:
            raise ValueError("Leaderboard limit must be between 1 and 10")
        with self._connect() as connection:
            return connection.execute(
                """SELECT t.hn_id, t.title, t.url, c.full_raw_text_contents, c.content_hash
                   FROM hacksnap_current_stories t
                   LEFT JOIN hn_thread_contents c USING (hn_id)
                   ORDER BY t.rank LIMIT %s""",
                (limit,),
            ).fetchall()

    def record_rank_history(self) -> None:
        # One statement gives all eligible stories the same observation time and
        # a consistent ranking, including positions below the display cutoff.
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO hacksnap_rank_history (hn_id, rank, observed_at)
                SELECT hn_id, rank, statement_timestamp() FROM hacksnap_ranked_stories
                """
            )

    def save_fetch_failure(self, story_id: int, article_url: str) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO hacksnap_fetch_failures (story_id, article_url)
                VALUES (%s, %s)
                ON CONFLICT (story_id) DO UPDATE SET
                    article_url = EXCLUDED.article_url, failed_at = CURRENT_TIMESTAMP
                """,
                (story_id, article_url),
            )

    def get_summary(self, story_id: int) -> dict | None:
        with self._connect() as connection:
            return connection.execute(
                """SELECT source_fingerprint, sentiment, source_coverage, summarized_content_hash,
                          discussion_analysis, discussion_analysis_metadata
                   FROM hacksnap_summaries WHERE story_id = %s""",
                (story_id,),
            ).fetchone()

    def get_discussion_analysis(self, story_id: int) -> dict | None:
        """Read claims, analysis, provenance, and time from one database snapshot."""
        with self._connect() as connection:
            return connection.execute(
                """SELECT discussion_analysis, discussion_analysis_metadata,
                          discussion_analyzed_at, discussion_analysis_coverage
                   FROM hacksnap_summaries
                   WHERE story_id = %s AND discussion_analysis IS NOT NULL""",
                (story_id,),
            ).fetchone()

    def save_discussion_analysis(
        self, story_id: int, analysis: DiscussionAnalysis, metadata: DiscussionAnalysisMetadata,
        *, content_hash: str | None = None, expected_fingerprint: str | None = None,
    ) -> bool:
        """Refresh an existing analysis atomically; never backfill legacy summaries.

        Returns False for absent or legacy summaries. Initial analysis is saved with
        save_summary(), so a new story's summary and analysis commit together.
        """
        if analysis is None or metadata is None:
            raise ValueError("A refresh requires discussion analysis and metadata")
        record = {
            "story_id": story_id, **_discussion_record(analysis, metadata),
            "content_hash": content_hash,
            "expected_fingerprint": expected_fingerprint,
        }
        with self._connect() as connection:
            result = connection.execute(
                """UPDATE hacksnap_summaries
                   SET discussion_analysis = %(discussion_analysis)s,
                       discussion_analysis_metadata = %(discussion_analysis_metadata)s,
                       discussion_analyzed_at = %(discussion_analyzed_at)s,
                       discussion_content_hash = %(content_hash)s,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE story_id = %(story_id)s AND discussion_analysis IS NOT NULL
                     AND (%(expected_fingerprint)s::text IS NULL OR
                          discussion_analysis_metadata->>'input_fingerprint' = %(expected_fingerprint)s)""",
                record,
            )
            return result.rowcount == 1

    def mark_discussion_contents(self, story_id: int, fingerprint: str, content_hash: str | None) -> None:
        """A cache hit can acknowledge a raw version without advancing analysis time."""
        with self._connect() as connection:
            result = connection.execute(
                """UPDATE hacksnap_summaries
                   SET discussion_content_hash = %s
                   WHERE story_id = %s AND discussion_analysis IS NOT NULL
                     AND discussion_analysis_metadata->>'input_fingerprint' = %s""",
                (content_hash, story_id, fingerprint),
            )
            if result.rowcount != 1:
                raise ValueError("Discussion analysis changed during cache acknowledgement")

    def save_sentiment(self, story_id: int, sentiment: int | None, metadata: dict) -> None:
        with self._connect() as connection:
            connection.execute(
                """UPDATE hacksnap_summaries
                   SET sentiment = %s,
                       source_coverage = source_coverage || %s,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE story_id = %s""",
                (sentiment, Jsonb({"sentiment": metadata}), story_id),
            )

    def save_summary(
        self,
        story_id: int,
        article_url: str | None,
        summary: StorySummary,
        fingerprint: str,
        model: str,
        prompt_version: str,
        coverage: dict,
        content_hash: str | None = None,
        *,
        discussion_analysis: DiscussionAnalysis | None = None,
        discussion_analysis_metadata: DiscussionAnalysisMetadata | None = None,
    ) -> None:
        # A legacy replacement clears prior analysis rather than retaining claims
        # tied to a potentially different article. Sentiment-only writes preserve it.
        record = {
            **_discussion_record(discussion_analysis, discussion_analysis_metadata),
            **summary.model_dump(exclude={"discussion_analysis"}),
            "story_id": story_id,
            "content_hash": content_hash,
            "article_url": article_url,
            "source_fingerprint": fingerprint,
            "model": model,
            "prompt_version": prompt_version,
            "source_coverage": coverage,
            "discussion_content_hash": content_hash if discussion_analysis is not None else None,
        }
        for key in ("article_key_points", "discussion_points", "source_coverage"):
            record[key] = Jsonb(record[key])
        with self._connect() as connection:
            result = connection.execute(
                """
                INSERT INTO hacksnap_summaries
                    (story_id, article_url, article_summary, article_key_points,
                     discussion_summary, discussion_points, sentiment, overall_takeaway,
                     source_fingerprint, model, prompt_version, source_coverage, summarized_content_hash,
                     discussion_analysis, discussion_analysis_metadata, discussion_analyzed_at,
                     discussion_content_hash)
                VALUES (%(story_id)s, %(article_url)s, %(article_summary)s,
                        %(article_key_points)s, %(discussion_summary)s, %(discussion_points)s,
                        %(sentiment)s, %(overall_takeaway)s, %(source_fingerprint)s, %(model)s,
                        %(prompt_version)s, %(source_coverage)s, %(content_hash)s,
                        %(discussion_analysis)s, %(discussion_analysis_metadata)s,
                        %(discussion_analyzed_at)s, %(discussion_content_hash)s)
                ON CONFLICT (story_id) DO UPDATE SET
                    discussion_analysis = EXCLUDED.discussion_analysis,
                    discussion_analysis_metadata = EXCLUDED.discussion_analysis_metadata,
                    discussion_analyzed_at = EXCLUDED.discussion_analyzed_at,
                    discussion_content_hash = EXCLUDED.discussion_content_hash,
                    summarized_content_hash = EXCLUDED.summarized_content_hash,
                    article_url = EXCLUDED.article_url,
                    article_summary = EXCLUDED.article_summary,
                    article_key_points = EXCLUDED.article_key_points,
                    discussion_summary = EXCLUDED.discussion_summary,
                    discussion_points = EXCLUDED.discussion_points,
                    sentiment = EXCLUDED.sentiment,
                    overall_takeaway = EXCLUDED.overall_takeaway,
                    source_fingerprint = EXCLUDED.source_fingerprint,
                    model = EXCLUDED.model, prompt_version = EXCLUDED.prompt_version,
                    source_coverage = EXCLUDED.source_coverage,
                    generated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE EXCLUDED.discussion_analysis IS NULL
                   OR hacksnap_summaries.discussion_analysis IS NOT NULL
            """,
                record,
            )
            if discussion_analysis is not None and result.rowcount != 1:
                raise ValueError("Cannot add discussion analysis to a legacy summary")

    def cleanup_contents(self, batch_size: int = 500) -> dict:
        with self._connect() as connection:
            return connection.execute("SELECT * FROM cleanup_hn_contents(%s)", (batch_size,)).fetchone()

    def mark_summarized_contents(self, story_id: int, fingerprint: str, content_hash: str | None) -> None:
        with self._connect() as connection:
            connection.execute(
                """UPDATE hacksnap_summaries SET summarized_content_hash = %s
                   WHERE story_id = %s AND source_fingerprint = %s""",
                (content_hash, story_id, fingerprint),
            )

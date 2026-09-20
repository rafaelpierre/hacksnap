"""Use the same TLS PostgreSQL connection pattern as the existing collector."""

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .models import StorySummary


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
                """SELECT source_fingerprint, sentiment, source_coverage, summarized_content_hash
                   FROM hacksnap_summaries WHERE story_id = %s""",
                (story_id,),
            ).fetchone()

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
    ) -> None:
        record = {
            **summary.model_dump(),
            "story_id": story_id,
            "content_hash": content_hash,
            "article_url": article_url,
            "source_fingerprint": fingerprint,
            "model": model,
            "prompt_version": prompt_version,
            "source_coverage": coverage,
        }
        for key in ("article_key_points", "discussion_points", "source_coverage"):
            record[key] = Jsonb(record[key])
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO hacksnap_summaries
                    (story_id, article_url, article_summary, article_key_points,
                     discussion_summary, discussion_points, sentiment, overall_takeaway,
                     source_fingerprint, model, prompt_version, source_coverage, summarized_content_hash)
                VALUES (%(story_id)s, %(article_url)s, %(article_summary)s,
                        %(article_key_points)s, %(discussion_summary)s, %(discussion_points)s,
                        %(sentiment)s, %(overall_takeaway)s, %(source_fingerprint)s, %(model)s,
                        %(prompt_version)s, %(source_coverage)s, %(content_hash)s)
                ON CONFLICT (story_id) DO UPDATE SET
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
            """,
                record,
            )

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

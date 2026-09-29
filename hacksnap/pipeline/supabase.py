"""Use the same TLS PostgreSQL connection pattern as the existing collector."""

from urllib.parse import urlsplit
from uuid import UUID, uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .models import DiscussionAnalysis, DiscussionAnalysisMetadata, StorySummary

IMAGE_SOURCE_TYPES = frozenset({"og", "twitter", "json_ld", "generated"})


def _valid_http_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        return (
            parsed.scheme in {"http", "https"} and bool(parsed.hostname)
            and parsed.username is None and parsed.password is None
        )
    except ValueError:
        return False


def _valid_canonical_blob_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        suffix = ".public.blob.vercel-storage.com"
        store = host.removesuffix(suffix)
        return (
            parsed.scheme == "https" and host.endswith(suffix)
            and bool(store) and "." not in store
            and all(c.isascii() and (c.isalnum() or c == "-") for c in store)
            and parsed.netloc == host and parsed.path.startswith("/articles/")
            and len(parsed.path) > len("/articles/") and not parsed.query and not parsed.fragment
        )
    except ValueError:
        return False


def _validate_image_source(source_url: str | None, source_type: str | None) -> None:
    if source_type is not None and source_type not in IMAGE_SOURCE_TYPES:
        raise ValueError("Invalid image source type")
    if source_url is not None and not _valid_http_url(source_url):
        raise ValueError("Image source URL must be HTTP or HTTPS")


def _validate_ready_image(
    image_url: str, source_url: str | None, source_type: str,
    width: int, height: int, mime_type: str,
) -> None:
    _validate_image_source(source_url, source_type)
    if source_type not in IMAGE_SOURCE_TYPES:
        raise ValueError("Ready image requires a source type")
    if not _valid_canonical_blob_url(image_url):
        raise ValueError("Image URL must be a canonical public Blob article URL")
    if width <= 0 or height <= 0:
        raise ValueError("Image dimensions must be positive")
    if not mime_type.startswith("image/"):
        raise ValueError("Image MIME type must begin with image/")


def _validate_image_policy(max_attempts: int, stale_seconds: int, retry_seconds: int) -> None:
    if max_attempts < 1 or stale_seconds < 1 or retry_seconds < 0:
        raise ValueError("Invalid image attempt policy")


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

    def claim_image_attempt(
        self, hn_id: int, *, replace: bool = False, max_attempts: int = 3,
        stale_after_seconds: int = 300, retry_after_seconds: int = 3600,
    ) -> str | None:
        """Atomically lease an image attempt; return None when the row is ineligible.

        A replacement keeps a ready image public while its new candidate is processed.
        The token prevents an expired worker from overwriting a later attempt.
        """
        _validate_image_policy(max_attempts, stale_after_seconds, retry_after_seconds)
        token = uuid4()
        params = {
            "hn_id": hn_id, "replace": replace, "token": token,
            "max_attempts": max_attempts,
            "stale_after_seconds": stale_after_seconds,
            "retry_after_seconds": retry_after_seconds,
        }
        with self._connect() as connection:
            # An abandoned final attempt must release its token, including a
            # replacement that kept a ready image visible. This locks one row.
            connection.execute(
                """UPDATE hacker_news_threads
                   SET image_status = CASE WHEN image_url IS NOT NULL THEN 'ready' ELSE 'failed' END,
                       image_attempt_token = NULL,
                       image_error = 'attempt_expired'
                   WHERE hn_id = %(hn_id)s AND image_status IN ('pending', 'ready')
                     AND image_attempt_token IS NOT NULL
                     AND image_attempt_count >= %(max_attempts)s
                     AND image_attempted_at <= statement_timestamp()
                         - make_interval(secs => %(stale_after_seconds)s)""",
                params,
            )
            row = connection.execute(
                """UPDATE hacker_news_threads
                   SET image_status = CASE WHEN image_url IS NOT NULL THEN 'ready' ELSE 'pending' END,
                       image_attempt_token = %(token)s,
                       image_attempted_at = statement_timestamp(),
                       image_attempt_count = COALESCE(image_attempt_count, 0) + 1,
                       image_error = NULL
                   WHERE hn_id = %(hn_id)s
                     AND COALESCE(image_attempt_count, 0) < %(max_attempts)s
                     AND (
                         (image_status IS NULL AND image_url IS NULL)
                         OR (image_status = 'failed' AND image_url IS NULL
                             AND image_attempted_at <= statement_timestamp()
                                 - make_interval(secs => %(retry_after_seconds)s))
                         OR (image_status = 'pending' AND image_url IS NULL
                             AND image_attempted_at <= statement_timestamp()
                                 - make_interval(secs => %(stale_after_seconds)s))
                         OR (%(replace)s AND image_status = 'ready' AND image_url IS NOT NULL
                             AND (image_attempt_token IS NULL OR image_attempted_at <=
                                 statement_timestamp() - make_interval(secs => %(stale_after_seconds)s))
                             AND (image_error IS NULL OR image_attempted_at <=
                                 statement_timestamp() - make_interval(secs => %(retry_after_seconds)s)))
                     )
                   RETURNING image_attempt_token""",
                params,
            ).fetchone()
            return str(row["image_attempt_token"]) if row else None

    def save_image_ready(
        self, hn_id: int, token: str, *, image_url: str,
        image_source_url: str | None, image_source_type: str,
        image_width: int, image_height: int, image_mime_type: str,
    ) -> bool:
        """Publish all public image metadata together only for the current lease."""
        _validate_ready_image(
            image_url, image_source_url, image_source_type,
            image_width, image_height, image_mime_type,
        )
        with self._connect() as connection:
            result = connection.execute(
                """UPDATE hacker_news_threads
                   SET image_url = %(image_url)s,
                       image_source_url = %(image_source_url)s,
                       image_source_type = %(image_source_type)s,
                       image_status = 'ready', image_width = %(image_width)s,
                       image_height = %(image_height)s,
                       image_mime_type = %(image_mime_type)s,
                       image_attempt_token = NULL, image_attempt_count = 0,
                       image_attempted_at = statement_timestamp(), image_error = NULL
                   WHERE hn_id = %(hn_id)s AND image_attempt_token = %(token)s
                     AND image_status IN ('pending', 'ready')""",
                {
                    "hn_id": hn_id, "token": UUID(str(token)), "image_url": image_url,
                    "image_source_url": image_source_url, "image_source_type": image_source_type,
                    "image_width": image_width, "image_height": image_height,
                    "image_mime_type": image_mime_type,
                },
            )
            return result.rowcount == 1

    def save_image_failed(
        self, hn_id: int, token: str, *, reason: str,
        image_source_url: str | None = None, image_source_type: str | None = None,
    ) -> bool:
        """End the current lease while retaining a previously published image."""
        if not reason.strip():
            raise ValueError("Image failure reason must be nonblank")
        if image_source_type is not None and image_source_type not in IMAGE_SOURCE_TYPES:
            raise ValueError("Invalid image source type")
        # Discovery can yield an unsafe or malformed URL. Recording the failure
        # must still release the lease; keep only safe HTTP provenance.
        if image_source_url is not None and not _valid_http_url(image_source_url):
            image_source_url = None
        with self._connect() as connection:
            result = connection.execute(
                """UPDATE hacker_news_threads
                   SET image_status = CASE WHEN image_url IS NOT NULL THEN 'ready' ELSE 'failed' END,
                       image_source_url = CASE WHEN image_url IS NOT NULL
                           THEN image_source_url ELSE %(image_source_url)s END,
                       image_source_type = CASE WHEN image_url IS NOT NULL
                           THEN image_source_type ELSE %(image_source_type)s END,
                       image_attempt_token = NULL,
                       image_attempted_at = statement_timestamp(),
                       image_error = %(reason)s
                   WHERE hn_id = %(hn_id)s AND image_attempt_token = %(token)s
                     AND image_status IN ('pending', 'ready')""",
                {
                    "hn_id": hn_id, "token": UUID(str(token)), "reason": reason,
                    "image_source_url": image_source_url, "image_source_type": image_source_type,
                },
            )
            return result.rowcount == 1

    def list_image_candidates(
        self, limit: int = 100, *, max_attempts: int = 3,
        stale_after_seconds: int = 300, retry_after_seconds: int = 3600,
    ) -> list[dict]:
        """List image-less articles eligible for a first or retried attempt."""
        _validate_image_policy(max_attempts, stale_after_seconds, retry_after_seconds)
        if not 1 <= limit <= 1000:
            raise ValueError("Image candidate limit must be between 1 and 1000")
        params = {
            "limit": limit, "max_attempts": max_attempts,
            "stale_after_seconds": stale_after_seconds,
            "retry_after_seconds": retry_after_seconds,
        }
        with self._connect() as connection:
            connection.execute(
                """WITH expired AS (
                       SELECT hn_id FROM hacker_news_threads
                       WHERE image_status IN ('pending', 'ready')
                         AND image_attempt_token IS NOT NULL
                         AND image_attempt_count >= %(max_attempts)s
                         AND image_attempted_at <= statement_timestamp()
                             - make_interval(secs => %(stale_after_seconds)s)
                       ORDER BY image_attempted_at, hn_id
                       LIMIT %(limit)s FOR UPDATE SKIP LOCKED
                   )
                   UPDATE hacker_news_threads AS threads
                   SET image_status = CASE WHEN threads.image_url IS NOT NULL
                       THEN 'ready' ELSE 'failed' END,
                       image_attempt_token = NULL,
                       image_error = 'attempt_expired'
                   FROM expired WHERE threads.hn_id = expired.hn_id""",
                params,
            )
            return connection.execute(
                """SELECT hn_id, url FROM hacker_news_threads
                   WHERE image_url IS NULL AND url ~* '^https?://'
                     AND COALESCE(image_attempt_count, 0) < %(max_attempts)s
                     AND (
                         image_status IS NULL
                         OR (image_status = 'failed' AND image_attempted_at <=
                             statement_timestamp() - make_interval(secs => %(retry_after_seconds)s))
                         OR (image_status = 'pending' AND image_attempted_at <=
                             statement_timestamp() - make_interval(secs => %(stale_after_seconds)s))
                     )
                   ORDER BY date_added DESC, hn_id DESC LIMIT %(limit)s""",
                params,
            ).fetchall()

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

"""Use the same TLS PostgreSQL connection pattern as the existing collector."""

from datetime import datetime
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


def _validate_added_window(
    added_from: datetime | None, added_before: datetime | None,
) -> None:
    for value in (added_from, added_before):
        if value is not None and (not isinstance(value, datetime) or value.utcoffset() is None):
            raise ValueError("Image date bounds must be timezone-aware datetimes")
    if added_from is not None and added_before is not None and added_from >= added_before:
        raise ValueError("Image date window must have a positive duration")


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

    @staticmethod
    def _reconcile_legacy_image_attempts(
        connection, *, stale_after_seconds: int = 900,
        retry_after_seconds: int = 3600, limit: int = 100,
        story_id: int | None = None, story_ids: list[int] | None = None,
        added_from: datetime | None = None, added_before: datetime | None = None,
    ) -> None:
        """Move expired 0015 leases and failures into the durable queue.

        An active old lease remains owned by its worker. Once stale, a row lock
        decides whether that worker committed first or the queue takes over.
        """
        _validate_added_window(added_from, added_before)
        connection.execute(
            """WITH legacy AS (
                   SELECT hn_id FROM hacker_news_threads
                   WHERE NOT image_queue_managed
                     AND (%(story_id)s::bigint IS NULL OR hn_id = %(story_id)s::bigint)
                     AND (%(story_ids)s::bigint[] IS NULL OR hn_id = ANY(%(story_ids)s::bigint[]))
                     AND (%(added_from)s::timestamptz IS NULL OR
                          date_added >= %(added_from)s::timestamptz)
                     AND (%(added_before)s::timestamptz IS NULL OR
                          date_added < %(added_before)s::timestamptz)
                     AND (
                         (image_attempt_token IS NOT NULL AND
                          image_attempted_at <= statement_timestamp() -
                              make_interval(secs => %(stale_after_seconds)s))
                         OR (image_status = 'failed' AND image_attempt_token IS NULL)
                     )
                   ORDER BY image_attempted_at, hn_id
                   LIMIT %(limit)s FOR UPDATE SKIP LOCKED
               )
               UPDATE hacker_news_threads AS t
               SET image_queue_managed = TRUE,
                   image_queued_at = statement_timestamp(),
                   image_requested_url = t.url,
                   image_attempts = COALESCE(t.image_attempt_count, 0),
                   image_retry_after = CASE WHEN t.image_status = 'failed' THEN
                       t.image_attempted_at + make_interval(secs => %(retry_after_seconds)s)
                       ELSE NULL END,
                   image_last_error = t.image_error,
                   image_attempt_token = NULL
               FROM legacy WHERE t.hn_id = legacy.hn_id""",
            {"story_id": story_id, "story_ids": story_ids,
             "added_from": added_from, "added_before": added_before,
             "stale_after_seconds": stale_after_seconds,
             "retry_after_seconds": retry_after_seconds, "limit": limit},
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
                   WHERE hn_id = %(hn_id)s AND NOT image_queue_managed
                     AND image_status IN ('pending', 'ready')
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
                   WHERE hn_id = %(hn_id)s AND NOT image_queue_managed
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

    def list_unqueued_image_candidates(
        self, limit: int = 100, *, max_attempts: int = 3,
        stale_after_seconds: int = 300, retry_after_seconds: int = 3600,
        added_from: datetime | None = None, added_before: datetime | None = None,
    ) -> list[dict]:
        """List image-less articles eligible for a first or retried attempt."""
        _validate_image_policy(max_attempts, stale_after_seconds, retry_after_seconds)
        _validate_added_window(added_from, added_before)
        if not 1 <= limit <= 1000:
            raise ValueError("Image candidate limit must be between 1 and 1000")
        params = {
            "limit": limit, "max_attempts": max_attempts,
            "stale_after_seconds": stale_after_seconds,
            "retry_after_seconds": retry_after_seconds,
            "added_from": added_from, "added_before": added_before,
        }
        with self._connect() as connection:
            connection.execute(
                """WITH expired AS (
                       SELECT hn_id FROM hacker_news_threads
                       WHERE NOT image_queue_managed AND image_status IN ('pending', 'ready')
                         AND (%(added_from)s::timestamptz IS NULL OR
                              date_added >= %(added_from)s::timestamptz)
                         AND (%(added_before)s::timestamptz IS NULL OR
                              date_added < %(added_before)s::timestamptz)
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
                   WHERE NOT image_queue_managed AND image_url IS NULL AND url ~* '^https?://'
                     AND (%(added_from)s::timestamptz IS NULL OR
                          date_added >= %(added_from)s::timestamptz)
                     AND (%(added_before)s::timestamptz IS NULL OR
                          date_added < %(added_before)s::timestamptz)
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

    def enqueue_image(
        self, story_id: int, article_url: str | None, *, force: bool = False,
        reprocess_ready: bool = False,
        added_from: datetime | None = None, added_before: datetime | None = None,
    ) -> bool:
        """Queue a published story. Existing ready images stay visible until replacement.

        Ordinary calls only queue a never-processed story. Retryable failures retain
        their queue and backoff; an explicit force can reopen a terminal failure.
        """
        if story_id <= 0:
            raise ValueError("A positive story ID is required")
        _validate_added_window(added_from, added_before)
        with self._connect() as connection:
            self._reconcile_legacy_image_attempts(
                connection, story_id=story_id, limit=1,
                added_from=added_from, added_before=added_before,
            )
            result = connection.execute(
                """UPDATE hacker_news_threads t
                   SET image_status = CASE WHEN image_url IS NULL THEN 'pending' ELSE 'ready' END,
                       image_queue_managed = TRUE,
                       image_queued_at = CURRENT_TIMESTAMP,
                       image_requested_url = %(article_url)s,
                       image_attempts = CASE WHEN %(force)s OR %(reprocess_ready)s OR
                           (t.image_queue_managed AND
                            t.image_requested_url IS DISTINCT FROM %(article_url)s)
                           THEN 0 ELSE image_attempts END,
                       image_retry_after = CASE WHEN %(force)s OR %(reprocess_ready)s OR
                           (t.image_queue_managed AND
                            t.image_requested_url IS DISTINCT FROM %(article_url)s)
                           THEN NULL ELSE image_retry_after END,
                       image_last_error = CASE WHEN %(force)s OR %(reprocess_ready)s OR
                           (t.image_queue_managed AND
                            t.image_requested_url IS DISTINCT FROM %(article_url)s)
                           THEN NULL ELSE image_last_error END,
                       image_lease_token = NULL, image_lease_expires_at = NULL
                   WHERE t.hn_id = %(story_id)s
                     AND (%(added_from)s::timestamptz IS NULL OR
                          t.date_added >= %(added_from)s::timestamptz)
                     AND (%(added_before)s::timestamptz IS NULL OR
                          t.date_added < %(added_before)s::timestamptz)
                     AND t.image_attempt_token IS NULL
                     AND t.url IS NOT DISTINCT FROM %(article_url)s
                     AND EXISTS (SELECT 1 FROM hacksnap_summaries s
                                 WHERE s.story_id = t.hn_id
                                   AND NULLIF(BTRIM(s.overall_takeaway), '') IS NOT NULL)
                     AND (t.image_lease_token IS NULL OR
                          t.image_lease_expires_at < CURRENT_TIMESTAMP)
                     AND (t.image_status IS NULL OR %(force)s OR
                          (t.image_queue_managed AND
                           t.image_requested_url IS DISTINCT FROM %(article_url)s) OR
                          (%(reprocess_ready)s AND t.image_status = 'ready'))""",
                {"story_id": story_id, "article_url": article_url,
                 "force": force, "reprocess_ready": reprocess_ready,
                 "added_from": added_from, "added_before": added_before},
            )
            return result.rowcount == 1

    def list_image_candidates(
        self, *, limit: int, after_id: int = 0, max_attempts: int = 3,
        include_failed: bool = False, reprocess_ready: bool = False,
        added_from: datetime | None = None, added_before: datetime | None = None,
    ) -> list[dict]:
        """Page eligible, published stories for a backfill without locking rows."""
        if not 1 <= limit <= 500 or after_id < 0 or max_attempts < 1:
            raise ValueError("Invalid image candidate page")
        _validate_added_window(added_from, added_before)
        with self._connect() as connection:
            return connection.execute(
                """SELECT t.hn_id AS story_id, t.title, t.url AS article_url,
                          t.category, t.image_status, t.image_attempts,
                          t.image_retry_after, t.image_url AS previous_image_url
                   FROM hacker_news_threads t
                   JOIN hacksnap_ranked_stories r ON r.hn_id = t.hn_id
                   JOIN hacksnap_summaries s ON s.story_id = t.hn_id
                   WHERE t.hn_id > %(after_id)s
                     AND (%(added_from)s::timestamptz IS NULL OR
                          t.date_added >= %(added_from)s::timestamptz)
                     AND (%(added_before)s::timestamptz IS NULL OR
                          t.date_added < %(added_before)s::timestamptz)
                     AND (t.image_attempt_token IS NULL OR
                          (NOT t.image_queue_managed AND
                           t.image_attempted_at <= statement_timestamp() -
                               INTERVAL '900 seconds'))
                     AND NULLIF(BTRIM(s.overall_takeaway), '') IS NOT NULL
                     AND (t.image_lease_token IS NULL OR
                          t.image_lease_expires_at < CURRENT_TIMESTAMP)
                     AND (t.image_status IS NULL
                          OR (t.image_queue_managed AND
                              t.image_requested_url IS DISTINCT FROM t.url)
                          OR (NOT t.image_queue_managed AND t.image_attempt_token IS NOT NULL
                              AND t.image_attempted_at <= statement_timestamp() -
                                  INTERVAL '900 seconds')
                          OR (NOT t.image_queue_managed AND t.image_status = 'failed'
                              AND COALESCE(t.image_attempt_count, 0) < %(max_attempts)s
                              AND t.image_attempted_at <= statement_timestamp() -
                                  INTERVAL '3600 seconds')
                          OR (t.image_queued_at IS NOT NULL AND
                              t.image_attempts < %(max_attempts)s AND
                              (t.image_retry_after IS NULL OR
                               t.image_retry_after <= CURRENT_TIMESTAMP))
                          OR (t.image_queued_at IS NOT NULL AND
                              t.image_attempts >= %(max_attempts)s)
                          OR (%(include_failed)s AND t.image_status = 'failed')
                          OR (%(reprocess_ready)s AND t.image_status = 'ready'))
                   ORDER BY t.hn_id LIMIT %(limit)s""",
                {"limit": limit, "after_id": after_id, "max_attempts": max_attempts,
                 "include_failed": include_failed, "reprocess_ready": reprocess_ready,
                 "added_from": added_from, "added_before": added_before},
            ).fetchall()

    def claim_pending_images(
        self, limit: int = 10, max_attempts: int = 3, lease_seconds: int = 300,
        *, story_ids: list[int] | None = None,
        added_from: datetime | None = None, added_before: datetime | None = None,
    ) -> list[dict]:
        """Atomically claim queued jobs. Expired leases are recoverable."""
        if not 1 <= limit <= 100 or max_attempts < 1 or not 30 <= lease_seconds <= 3600:
            raise ValueError("Invalid image claim limits")
        if story_ids is not None and (not story_ids or any(sid <= 0 for sid in story_ids)):
            raise ValueError("story_ids must contain positive IDs")
        _validate_added_window(added_from, added_before)
        with self._connect() as connection:
            self._reconcile_legacy_image_attempts(
                connection, limit=100, story_ids=story_ids,
                added_from=added_from, added_before=added_before,
            )
            # A crashed worker on its last permitted attempt must not leave a
            # permanently pending row. Operators can explicitly requeue it.
            connection.execute(
                """UPDATE hacker_news_threads
                   SET image_status = CASE WHEN image_url IS NULL THEN 'failed' ELSE 'ready' END,
                       image_queued_at = NULL, image_lease_token = NULL,
                       image_lease_expires_at = NULL, image_retry_after = NULL,
                       image_last_error = 'Image lease expired after final attempt'
                   WHERE image_queued_at IS NOT NULL AND image_attempts >= %s
                     AND (%s::bigint[] IS NULL OR hn_id = ANY(%s::bigint[]))
                     AND (%s::timestamptz IS NULL OR date_added >= %s::timestamptz)
                     AND (%s::timestamptz IS NULL OR date_added < %s::timestamptz)
                     AND image_attempt_token IS NULL
                     AND (image_lease_token IS NULL OR
                          image_lease_expires_at < CURRENT_TIMESTAMP)""",
                (max_attempts, story_ids, story_ids, added_from, added_from,
                 added_before, added_before),
            )
            return connection.execute(
                """WITH picked AS (
                       SELECT t.hn_id FROM hacker_news_threads t
                       JOIN hacksnap_summaries s ON s.story_id = t.hn_id
                       WHERE t.image_queued_at IS NOT NULL
                         AND (%(added_from)s::timestamptz IS NULL OR
                              t.date_added >= %(added_from)s::timestamptz)
                         AND (%(added_before)s::timestamptz IS NULL OR
                              t.date_added < %(added_before)s::timestamptz)
                         AND t.image_queue_managed
                         AND t.image_attempt_token IS NULL
                         AND t.image_attempts < %(max_attempts)s
                         AND (t.image_retry_after IS NULL OR
                              t.image_retry_after <= CURRENT_TIMESTAMP)
                         AND (t.image_lease_token IS NULL OR
                              t.image_lease_expires_at < CURRENT_TIMESTAMP)
                         AND t.url IS NOT DISTINCT FROM t.image_requested_url
                         AND NULLIF(BTRIM(s.overall_takeaway), '') IS NOT NULL
                         AND (%(story_ids)s::bigint[] IS NULL OR
                              t.hn_id = ANY(%(story_ids)s::bigint[]))
                       ORDER BY t.hn_id LIMIT %(limit)s FOR UPDATE OF t SKIP LOCKED
                   )
                   UPDATE hacker_news_threads t
                   SET image_lease_token = gen_random_uuid(),
                       image_lease_expires_at = CURRENT_TIMESTAMP +
                                                (%(lease_seconds)s * INTERVAL '1 second'),
                       image_attempts = t.image_attempts + 1,
                       image_status = CASE WHEN t.image_url IS NULL THEN 'pending' ELSE 'ready' END
                   FROM picked WHERE t.hn_id = picked.hn_id
                   RETURNING t.hn_id AS story_id, t.title,
                             t.image_requested_url AS article_url, t.category,
                             t.image_lease_token AS lease_token, t.image_attempts AS attempts,
                             t.image_url AS previous_image_url""",
                {"limit": limit, "max_attempts": max_attempts,
                 "lease_seconds": lease_seconds, "story_ids": story_ids,
                 "added_from": added_from, "added_before": added_before},
            ).fetchall()

    def mark_image_ready(
        self, story_id: int, lease_token: str, image_url: str, source_type: str,
        source_url: str | None = None, *, width: int, height: int,
        mime_type: str = "image/webp",
    ) -> bool:
        """Publish only the result of the current lease and source article URL."""
        parsed = urlsplit(image_url)
        if (story_id <= 0 or not lease_token or not _valid_canonical_blob_url(image_url)
                or not parsed.path.startswith(f"/articles/{story_id}/hero-")
                or not parsed.path.endswith(".webp")):
            raise ValueError("Invalid public article Blob URL")
        if source_type not in {"og", "twitter", "json_ld", "generated"}:
            raise ValueError("Invalid image source type")
        if (source_type == "generated") != (source_url is None):
            raise ValueError("Generated images need null provenance; sourced images need a URL")
        if source_url is not None and not _valid_http_url(source_url):
            raise ValueError("Invalid image source URL")
        if width <= 0 or height <= 0 or mime_type != "image/webp":
            raise ValueError("Invalid WebP dimensions or MIME type")
        with self._connect() as connection:
            result = connection.execute(
                """UPDATE hacker_news_threads
                   SET image_url = %(image_url)s, image_source_url = %(source_url)s,
                       image_source_type = %(source_type)s, image_status = 'ready',
                       image_width = %(width)s, image_height = %(height)s,
                       image_mime_type = %(mime_type)s, image_attempts = 0,
                       image_queued_at = NULL, image_lease_token = NULL,
                       image_lease_expires_at = NULL, image_retry_after = NULL,
                       image_last_error = NULL
                   WHERE hn_id = %(story_id)s AND image_lease_token = %(lease_token)s::uuid
                     AND image_lease_expires_at >= CURRENT_TIMESTAMP
                     AND url IS NOT DISTINCT FROM image_requested_url""",
                {"story_id": story_id, "lease_token": lease_token, "image_url": image_url,
                 "source_type": source_type, "source_url": source_url,
                 "width": width, "height": height, "mime_type": mime_type},
            )
            return result.rowcount == 1

    def mark_image_failed(
        self, story_id: int, lease_token: str, reason: str, *, retryable: bool = True,
    ) -> bool:
        """Record a failed attempt while retaining any previously published asset."""
        if story_id <= 0 or not lease_token or not reason.strip():
            raise ValueError("Image failure needs an ID, lease token, and reason")
        with self._connect() as connection:
            result = connection.execute(
                """UPDATE hacker_news_threads
                   SET image_status = CASE WHEN image_url IS NULL THEN 'failed' ELSE 'ready' END,
                       image_last_error = %(reason)s,
                       image_queued_at = CASE WHEN %(retryable)s THEN image_queued_at ELSE NULL END,
                       image_retry_after = CASE WHEN %(retryable)s THEN
                           CURRENT_TIMESTAMP +
                           (LEAST(3600, 300 * power(2, LEAST(image_attempts - 1, 4)))
                            * INTERVAL '1 second') ELSE NULL END,
                       image_lease_token = NULL, image_lease_expires_at = NULL
                   WHERE hn_id = %(story_id)s AND image_lease_token = %(lease_token)s::uuid
                     AND image_lease_expires_at >= CURRENT_TIMESTAMP""",
                {"story_id": story_id, "lease_token": lease_token,
                 "reason": reason[:500], "retryable": retryable},
            )
            return result.rowcount == 1

    def is_image_url_current(self, story_id: int, image_url: str) -> bool:
        """Resolve an uncertain commit before deleting a newly uploaded blob."""
        with self._connect() as connection:
            row = connection.execute(
                """SELECT 1 FROM hacker_news_threads
                   WHERE hn_id = %s AND image_url = %s AND image_status = 'ready'""",
                (story_id, image_url),
            ).fetchone()
            return row is not None

"""Deliver durable cache invalidations without coupling publication to HTTP availability."""

import logging
import os
from urllib.parse import urlsplit
from uuid import uuid4

import httpx

from .config import database_url_from_env
from .supabase import Repository

logger = logging.getLogger("hacksnap.publication")
BATCH_SIZE = 32


def dispatch(repository: Repository, url: str, secret: str) -> dict:
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.query or parsed.fragment
            or parsed.path != "/api/revalidate-publication" or len(secret) < 32):
        raise ValueError("Set an HTTPS publication webhook URL and a secret of at least 32 characters")
    lease_id = uuid4()
    # The lease commits before network I/O. A killed worker leaves a recoverable
    # pending row; a second worker can reclaim it after the two-minute lease.
    with repository._connect() as connection:
        rows = connection.execute("""
            WITH claimed AS (
                SELECT event_id FROM hacksnap_publication_outbox
                WHERE delivered_at IS NULL AND available_at <= clock_timestamp()
                ORDER BY available_at, event_id LIMIT %s FOR UPDATE SKIP LOCKED
            )
            UPDATE hacksnap_publication_outbox o
            SET lease_id = %s, attempts = attempts + 1,
                available_at = clock_timestamp() + interval '2 minutes'
            FROM claimed WHERE o.event_id = claimed.event_id
            RETURNING o.event_id, o.story_id, o.kind
        """, (BATCH_SIZE, lease_id)).fetchall()
    if not rows:
        return {"delivered": 0, "failed": 0}
    payload = {"changes": [{"storyId": str(row["story_id"]), "kind": row["kind"]} for row in rows]}
    try:
        with httpx.Client(timeout=45, follow_redirects=False) as client:
            response = client.post(url, headers={"Authorization": f"Bearer {secret}"}, json=payload)
            response.raise_for_status()
            # Warm in a separate request, after the invalidation response has
            # finalized. Warming before returning that response can hit old ISR.
            response = client.post(url, headers={
                "Authorization": f"Bearer {secret}", "X-Hacksnap-Publication-Phase": "warm",
            }, json=payload)
            response.raise_for_status()
    except Exception as exc:  # noqa: BLE001 - a committed publication must survive delivery failure
        with repository._connect() as connection:
            connection.execute("""
                UPDATE hacksnap_publication_outbox
                SET lease_id = NULL, available_at = clock_timestamp()
                    + make_interval(secs => LEAST(900, 15 * power(2, LEAST(attempts, 6)))::integer)
                WHERE lease_id = %s AND delivered_at IS NULL
            """, (lease_id,))
        logger.warning("publication_delivery_failed count=%s error_type=%s", len(rows), type(exc).__name__)
        return {"delivered": 0, "failed": len(rows)}
    with repository._connect() as connection:
        connection.execute("""
            UPDATE hacksnap_publication_outbox
            SET delivered_at = clock_timestamp(), lease_id = NULL
            WHERE lease_id = %s AND delivered_at IS NULL
        """, (lease_id,))
        backlog = connection.execute("""
            SELECT count(*) AS pending, EXTRACT(EPOCH FROM
                clock_timestamp() - min(created_at)) AS oldest_seconds
            FROM hacksnap_publication_outbox WHERE delivered_at IS NULL
        """).fetchone()
    logger.info("publication_delivered count=%s pending=%s oldest_seconds=%s",
                len(rows), backlog["pending"], backlog["oldest_seconds"])
    return {"delivered": len(rows), "failed": 0}


def dispatch_from_env() -> dict:
    url = os.environ.get("HACKSNAP_PUBLICATION_WEBHOOK_URL", "")
    secret = os.environ.get("HACKSNAP_PUBLICATION_SECRET", "")
    if not url or not secret:
        return {"status": "disabled"}
    return dispatch(Repository(database_url_from_env()), url, secret)


def try_dispatch() -> None:
    try:
        dispatch_from_env()
    except Exception as exc:  # noqa: BLE001 - the minute dispatcher retries durable rows
        logger.warning("publication_dispatch_failed error_type=%s", type(exc).__name__)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    print(dispatch_from_env())

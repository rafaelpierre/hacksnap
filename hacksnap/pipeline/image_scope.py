"""Fixed article-date scope for the 29 September 2026 image backfill."""

from datetime import UTC, date, datetime

BACKFILL_DATE = date(2026, 9, 29)
BACKFILL_TIMEZONE = "Europe/London"
# London was on BST (UTC+1) for this fixed day. Store the exact UTC instants
# so a minimal worker image needs no runtime timezone database.
BACKFILL_START = datetime(2026, 9, 28, 23, tzinfo=UTC)
BACKFILL_END = datetime(2026, 9, 29, 23, tzinfo=UTC)


def scope_result(*, scheduled: bool = False) -> dict[str, str | None]:
    """Describe the enforced date window in machine-readable job results."""
    return {
        "article_added_date": BACKFILL_DATE.isoformat(),
        "article_added_timezone": BACKFILL_TIMEZONE,
        "article_added_from": BACKFILL_START.isoformat().replace("+00:00", "Z"),
        "article_added_before": (
            None if scheduled else BACKFILL_END.isoformat().replace("+00:00", "Z")
        ),
    }

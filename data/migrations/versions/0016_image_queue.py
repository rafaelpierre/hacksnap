"""Add a durable image queue beside the original image attempt lease.

Rows already processed under 0015 keep their image and lease state. The queue
flag lets the old and new workers coexist during rollout without double claims.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0016_image_queue"
down_revision = "0015_article_images"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("hacker_news_threads", sa.Column(
        "image_queue_managed", sa.Boolean(), nullable=False, server_default=sa.false()))
    for name in ("image_requested_url", "image_last_error"):
        op.add_column("hacker_news_threads", sa.Column(name, sa.Text(), nullable=True))
    op.add_column("hacker_news_threads", sa.Column(
        "image_attempts", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("hacker_news_threads", sa.Column(
        "image_lease_token", postgresql.UUID(as_uuid=True), nullable=True))
    for name in ("image_queued_at", "image_lease_expires_at", "image_retry_after"):
        op.add_column("hacker_news_threads", sa.Column(
            name, sa.DateTime(timezone=True), nullable=True))

    op.drop_constraint("hn_image_lease", "hacker_news_threads", type_="check")
    op.create_check_constraint("hn_image_lease", "hacker_news_threads", """
        (
            (image_status = 'pending' AND (
                (image_queue_managed AND image_queued_at IS NOT NULL
                 AND image_attempt_token IS NULL)
                OR
                (NOT image_queue_managed AND image_attempt_token IS NOT NULL
                 AND image_attempted_at IS NOT NULL AND image_attempt_count > 0)
            ))
            OR
            (image_status IS DISTINCT FROM 'pending'
             AND (image_attempt_token IS NULL OR
                  (image_status = 'ready' AND image_attempted_at IS NOT NULL)))
        ) IS TRUE
    """)
    op.create_check_constraint("hn_image_queue", "hacker_news_threads", """
        image_attempts >= 0
        AND (image_lease_token IS NULL) = (image_lease_expires_at IS NULL)
        AND (image_lease_token IS NULL OR image_queued_at IS NOT NULL)
        AND (image_queued_at IS NULL OR image_queue_managed)
        AND (image_lease_token IS NULL OR image_attempt_token IS NULL)
    """)
    op.create_index(
        "hn_image_queue_idx", "hacker_news_threads",
        ["image_retry_after", "hn_id"],
        postgresql_where=sa.text("image_queued_at IS NOT NULL"),
    )


def downgrade() -> None:
    # Active queue work cannot satisfy the original pending lease check.
    op.execute("""UPDATE hacker_news_threads
        SET image_status = CASE WHEN image_url IS NULL THEN 'failed' ELSE 'ready' END,
            image_queued_at = NULL, image_lease_token = NULL,
            image_lease_expires_at = NULL
        WHERE image_queue_managed AND image_status = 'pending'""")
    op.drop_index("hn_image_queue_idx", table_name="hacker_news_threads")
    op.drop_constraint("hn_image_queue", "hacker_news_threads", type_="check")
    op.drop_constraint("hn_image_lease", "hacker_news_threads", type_="check")
    op.create_check_constraint("hn_image_lease", "hacker_news_threads", """
        (
            (image_status = 'pending' AND image_attempt_token IS NOT NULL
             AND image_attempted_at IS NOT NULL AND image_attempt_count > 0)
            OR
            (image_status IS DISTINCT FROM 'pending'
             AND (image_attempt_token IS NULL OR
                  (image_status = 'ready' AND image_attempted_at IS NOT NULL)))
        ) IS TRUE
    """)
    for name in (
        "image_retry_after", "image_lease_expires_at", "image_queued_at",
        "image_lease_token", "image_attempts", "image_last_error",
        "image_requested_url", "image_queue_managed",
    ):
        op.drop_column("hacker_news_threads", name)

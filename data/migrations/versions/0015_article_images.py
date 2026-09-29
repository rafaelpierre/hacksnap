"""Add canonical article images and private retry leases.

Existing stories keep NULL image fields and remain eligible for backfill.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0015_article_images"
down_revision = "0014_story_slugs"
branch_labels = None
depends_on = None

PUBLIC_IMAGE_COLUMNS = "image_url,image_status,image_width,image_height,image_mime_type"


def upgrade() -> None:
    for column in (
        sa.Column("image_url", sa.Text(), nullable=True),
        sa.Column("image_source_url", sa.Text(), nullable=True),
        sa.Column("image_source_type", sa.Text(), nullable=True),
        sa.Column("image_status", sa.Text(), nullable=True),
        sa.Column("image_width", sa.Integer(), nullable=True),
        sa.Column("image_height", sa.Integer(), nullable=True),
        sa.Column("image_mime_type", sa.Text(), nullable=True),
        sa.Column("image_attempt_token", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("image_attempt_count", sa.Integer(), nullable=True),
        sa.Column("image_attempted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("image_error", sa.Text(), nullable=True),
    ):
        op.add_column("hacker_news_threads", column)

    op.create_check_constraint(
        "hn_image_source_type", "hacker_news_threads",
        "image_source_type IS NULL OR image_source_type IN ('og', 'twitter', 'json_ld', 'generated')",
    )
    op.create_check_constraint(
        "hn_image_status", "hacker_news_threads",
        "image_status IS NULL OR image_status IN ('pending', 'ready', 'failed')",
    )
    op.create_check_constraint(
        "hn_image_attempt_count", "hacker_news_threads",
        "image_attempt_count IS NULL OR image_attempt_count >= 0",
    )
    op.create_check_constraint(
        "hn_image_public_bundle", "hacker_news_threads", """
        (
            (image_status = 'ready' AND image_url IS NOT NULL
             AND image_url ~ '^https://[a-zA-Z0-9-]+[.]public[.]blob[.]vercel-storage[.]com/articles/[^?#]+$'
             AND image_width > 0 AND image_height > 0
             AND image_mime_type LIKE 'image/%' AND image_source_type IS NOT NULL)
            OR
            (image_status IS DISTINCT FROM 'ready' AND image_url IS NULL
             AND image_width IS NULL AND image_height IS NULL AND image_mime_type IS NULL)
        ) IS TRUE
    """,
    )
    op.create_check_constraint(
        "hn_image_lease", "hacker_news_threads", """
        (
            (image_status = 'pending' AND image_attempt_token IS NOT NULL
             AND image_attempted_at IS NOT NULL AND image_attempt_count > 0)
            OR
            (image_status IS DISTINCT FROM 'pending'
             AND (image_attempt_token IS NULL OR
                  (image_status = 'ready' AND image_attempted_at IS NOT NULL)))
        ) IS TRUE
    """,
    )
    op.create_index(
        "hacker_news_threads_image_backfill_idx", "hacker_news_threads",
        [sa.text("date_added DESC"), sa.text("hn_id DESC")],
        postgresql_where=sa.text("image_url IS NULL"),
    )
    op.create_index(
        "hacker_news_threads_image_lease_idx", "hacker_news_threads",
        ["image_attempted_at"],
        postgresql_where=sa.text("image_attempt_token IS NOT NULL"),
    )
    op.execute(
        f"GRANT SELECT ({PUBLIC_IMAGE_COLUMNS}) ON hacker_news_threads TO hacksnap_reader"
    )


def downgrade() -> None:
    op.execute(
        f"REVOKE SELECT ({PUBLIC_IMAGE_COLUMNS}) ON hacker_news_threads FROM hacksnap_reader"
    )
    op.drop_index("hacker_news_threads_image_lease_idx", table_name="hacker_news_threads")
    op.drop_index("hacker_news_threads_image_backfill_idx", table_name="hacker_news_threads")
    for name in (
        "hn_image_lease", "hn_image_public_bundle", "hn_image_attempt_count",
        "hn_image_status", "hn_image_source_type",
    ):
        op.drop_constraint(name, "hacker_news_threads", type_="check")
    for name in (
        "image_error", "image_attempted_at", "image_attempt_count", "image_attempt_token",
        "image_mime_type", "image_height", "image_width", "image_status",
        "image_source_type", "image_source_url", "image_url",
    ):
        op.drop_column("hacker_news_threads", name)

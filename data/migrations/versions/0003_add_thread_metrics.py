"""Add current Hacker News points and comment-count metrics.

Revision ID: 0003_add_thread_metrics
Revises: 0002_pipeline_history
"""

from alembic import op
import sqlalchemy as sa


revision = "0003_add_thread_metrics"
down_revision = "0002_pipeline_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "hacker_news_threads",
        sa.Column("points", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "hacker_news_threads",
        sa.Column("comment_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.execute(
        """
        UPDATE hacker_news_threads
        SET
            points = COALESCE((full_raw_text_contents::jsonb -> 'story' ->> 'score')::integer, 0),
            comment_count = COALESCE(
                (full_raw_text_contents::jsonb -> 'story' ->> 'descendants')::integer,
                0
            )
        """
    )
    op.alter_column("hacker_news_threads", "points", server_default=None)
    op.alter_column("hacker_news_threads", "comment_count", server_default=None)


def downgrade() -> None:
    op.drop_column("hacker_news_threads", "comment_count")
    op.drop_column("hacker_news_threads", "points")

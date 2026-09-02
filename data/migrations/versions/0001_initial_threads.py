"""Create the initial current-thread table.

Revision ID: 0001_initial_threads
Revises:
"""

from alembic import op
import sqlalchemy as sa


revision = "0001_initial_threads"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "hacker_news_threads",
        sa.Column("hn_id", sa.BigInteger(), primary_key=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("full_raw_text_contents", sa.Text(), nullable=False),
        sa.Column("date_published", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "date_added",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("author", sa.Text(), nullable=True),
    )
    op.create_index(
        "hacker_news_threads_date_published_idx",
        "hacker_news_threads",
        ["date_published"],
        postgresql_using="btree",
    )
    op.execute("ALTER TABLE hacker_news_threads ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("hacker_news_threads_date_published_idx", table_name="hacker_news_threads")
    op.drop_table("hacker_news_threads")

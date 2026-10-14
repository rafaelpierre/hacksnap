"""Store generated headlines separately from original Hacker News titles.

Revision ID: 0023_editorial_titles
Revises: 0022_image_source_reader
Create Date: 2026-10-14 17:39:51.149693
"""

from alembic import op
import sqlalchemy as sa


revision = "0023_editorial_titles"
down_revision = "0022_image_source_reader"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("hacksnap_summaries", sa.Column("title", sa.Text(), nullable=True))
    op.create_check_constraint(
        "hacksnap_summaries_title_check", "hacksnap_summaries",
        "title IS NULL OR (char_length(title) BETWEEN 1 AND 160 "
        "AND title ~ '[^[:space:]]' AND title !~ E'[\\r\\n]')",
    )
    op.execute("GRANT SELECT (title) ON public.hacksnap_summaries TO hacksnap_reader")


def downgrade() -> None:
    op.drop_constraint("hacksnap_summaries_title_check", "hacksnap_summaries", type_="check")
    op.drop_column("hacksnap_summaries", "title")

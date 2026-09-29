"""Allow new stories to retain the slug assigned at first ingestion.

Existing rows remain NULL and keep their numeric public URL. No backfill.
"""
from alembic import op
import sqlalchemy as sa

revision = "0014_story_slugs"
down_revision = "0013_discussion_retention"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("hacker_news_threads", sa.Column("story_slug", sa.Text(), nullable=True))
    op.create_check_constraint("hn_story_slug_format", "hacker_news_threads", """
        story_slug IS NULL OR (
            length(story_slug) <= 96
            AND story_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*-[1-9][0-9]{0,14}$'
            AND right(story_slug, length(hn_id::text) + 1) = '-' || hn_id::text
        )
    """)
    op.execute("GRANT SELECT (story_slug) ON hacker_news_threads TO hacksnap_reader")


def downgrade():
    op.execute("REVOKE SELECT (story_slug) ON hacker_news_threads FROM hacksnap_reader")
    op.drop_constraint("hn_story_slug_format", "hacker_news_threads", type_="check")
    op.drop_column("hacker_news_threads", "story_slug")

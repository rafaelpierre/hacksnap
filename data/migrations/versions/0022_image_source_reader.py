"""Let the web reader distinguish publisher images from generated fallbacks."""

from alembic import op

revision = "0022_image_source_reader"
down_revision = "0021_weekly_story_popularity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "GRANT SELECT (image_source_type) ON public.hacker_news_threads TO hacksnap_reader"
    )


def downgrade() -> None:
    op.execute(
        "REVOKE SELECT (image_source_type) ON public.hacker_news_threads FROM hacksnap_reader"
    )

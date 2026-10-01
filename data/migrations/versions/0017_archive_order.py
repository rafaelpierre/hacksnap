"""Support Latest and monthly archive ordering at deep offsets."""

from alembic import op


revision = "0017_archive_order"
down_revision = "0016_image_queue"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""CREATE INDEX hn_archive_date_idx ON hacker_news_threads
        (date_added DESC, hn_id DESC)""")


def downgrade() -> None:
    op.drop_index("hn_archive_date_idx", table_name="hacker_news_threads")

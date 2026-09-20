"""Store comment sentiment alongside generated summaries."""

import sqlalchemy as sa
from alembic import op

revision = "0009_sentiment"
down_revision = "0008_disposable_contents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # NULL preserves the distinction between unscored legacy summaries and Neutral.
    op.add_column("hacksnap_summaries", sa.Column("sentiment", sa.SmallInteger(), nullable=True))
    op.create_check_constraint(
        "hacksnap_sentiment_range", "hacksnap_summaries", "sentiment IN (-1, 0, 1)"
    )


def downgrade() -> None:
    op.drop_constraint("hacksnap_sentiment_range", "hacksnap_summaries", type_="check")
    op.drop_column("hacksnap_summaries", "sentiment")

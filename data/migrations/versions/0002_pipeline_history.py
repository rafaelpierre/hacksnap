"""Add immutable ingestion snapshots and LLM summary records.

Revision ID: 0002_pipeline_history
Revises: 0001_initial_threads
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0002_pipeline_history"
down_revision = "0001_initial_threads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE hacker_news_threads ENABLE ROW LEVEL SECURITY")

    op.create_table(
        "hn_ingestion_runs",
        sa.Column("run_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column(
            "filters",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("stories_examined", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("threads_matched", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("snapshots_inserted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status IN ('running', 'succeeded', 'failed')",
            name="hn_ingestion_runs_status_check",
        ),
    )
    op.create_index(
        "hn_ingestion_runs_started_at_idx",
        "hn_ingestion_runs",
        ["started_at"],
        postgresql_using="btree",
    )

    op.create_table(
        "hn_thread_snapshots",
        sa.Column("snapshot_id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("hn_ingestion_runs.run_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "hn_id",
            sa.BigInteger(),
            sa.ForeignKey("hacker_news_threads.hn_id"),
            nullable=False,
        ),
        sa.Column("raw_payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("descendants", sa.Integer(), nullable=False),
        sa.Column("top_story_rank", sa.Integer(), nullable=False),
        sa.Column("max_comment_depth", sa.SmallInteger(), nullable=False),
        sa.Column(
            "observed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.UniqueConstraint("hn_id", "content_hash", name="hn_thread_snapshots_hn_id_hash_key"),
    )
    op.create_index(
        "hn_thread_snapshots_hn_id_observed_at_idx",
        "hn_thread_snapshots",
        ["hn_id", sa.text("observed_at DESC")],
        postgresql_using="btree",
    )
    op.create_index(
        "hn_thread_snapshots_run_id_idx",
        "hn_thread_snapshots",
        ["run_id"],
        postgresql_using="btree",
    )

    op.create_table(
        "hn_thread_summaries",
        sa.Column("summary_id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "snapshot_id",
            sa.BigInteger(),
            sa.ForeignKey("hn_thread_snapshots.snapshot_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("prompt_version", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "status IN ('queued', 'processing', 'succeeded', 'failed')",
            name="hn_thread_summaries_status_check",
        ),
        sa.UniqueConstraint(
            "snapshot_id",
            "model",
            "prompt_version",
            name="hn_thread_summaries_snapshot_model_prompt_key",
        ),
    )
    op.create_index(
        "hn_thread_summaries_status_created_at_idx",
        "hn_thread_summaries",
        ["status", "created_at"],
        postgresql_using="btree",
    )

    for table_name in ("hn_ingestion_runs", "hn_thread_snapshots", "hn_thread_summaries"):
        op.execute(f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_index("hn_thread_summaries_status_created_at_idx", table_name="hn_thread_summaries")
    op.drop_table("hn_thread_summaries")
    op.drop_index("hn_thread_snapshots_run_id_idx", table_name="hn_thread_snapshots")
    op.drop_index("hn_thread_snapshots_hn_id_observed_at_idx", table_name="hn_thread_snapshots")
    op.drop_table("hn_thread_snapshots")
    op.drop_index("hn_ingestion_runs_started_at_idx", table_name="hn_ingestion_runs")
    op.drop_table("hn_ingestion_runs")

"""Track current run membership and store validated Hacksnap enrichment."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004_hacksnap"
down_revision = "0003_add_thread_metrics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("hacker_news_threads", sa.Column(
        "last_seen_run_id", postgresql.UUID(as_uuid=True),
        sa.ForeignKey("hn_ingestion_runs.run_id", ondelete="SET NULL"), nullable=True,
    ))
    op.create_index("hacker_news_threads_last_seen_run_idx", "hacker_news_threads", ["last_seen_run_id"])
    # Best available historical membership; the next ingestion establishes exact membership.
    op.execute("""
        UPDATE hacker_news_threads t SET last_seen_run_id = latest.run_id
        FROM (
            SELECT DISTINCT ON (s.hn_id) s.hn_id, s.run_id
            FROM hn_thread_snapshots s JOIN hn_ingestion_runs r USING (run_id)
            WHERE r.status = 'succeeded'
            ORDER BY s.hn_id, r.started_at DESC, r.run_id DESC
        ) latest WHERE latest.hn_id = t.hn_id
    """)
    op.create_table(
        "hacksnap_summaries",
        sa.Column("story_id", sa.BigInteger(), sa.ForeignKey("hacker_news_threads.hn_id", ondelete="CASCADE"), primary_key=True),
        sa.Column("article_url", sa.Text(), nullable=True),
        sa.Column("article_summary", sa.Text(), nullable=True),
        sa.Column("article_key_points", postgresql.JSONB(), nullable=False),
        sa.Column("discussion_summary", sa.Text(), nullable=False),
        sa.Column("discussion_points", postgresql.JSONB(), nullable=False),
        sa.Column("overall_takeaway", sa.Text(), nullable=False),
        sa.Column("model", sa.Text(), nullable=False),
        sa.Column("prompt_version", sa.Text(), nullable=False),
        sa.Column("source_fingerprint", sa.String(64), nullable=False),
        sa.Column("source_coverage", postgresql.JSONB(), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("jsonb_typeof(article_key_points) = 'array'", name="hacksnap_key_points_array"),
        sa.CheckConstraint("jsonb_typeof(discussion_points) = 'array'", name="hacksnap_discussion_points_array"),
    )
    op.execute("ALTER TABLE hacksnap_summaries ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON hacksnap_summaries FROM PUBLIC")
    # One definition of eligibility and ranking, shared by the worker and website.
    op.execute("""
        CREATE VIEW hacksnap_current_stories WITH (security_invoker = true) AS
        WITH candidates AS (
            SELECT t.*, r.finished_at AS ingestion_finished_at,
                   t.date_added >= CURRENT_TIMESTAMP - INTERVAL '24 hours' AS is_recent
            FROM hacker_news_threads t JOIN hn_ingestion_runs r ON r.run_id = t.last_seen_run_id
            WHERE (
                (r.status = 'succeeded' AND r.filters @> '{"classify_topic": true}'::jsonb)
                OR EXISTS (
                    SELECT 1 FROM hn_thread_snapshots s
                    JOIN hn_ingestion_runs previous_run ON previous_run.run_id = s.run_id
                    WHERE s.hn_id = t.hn_id AND previous_run.status = 'succeeded'
                      AND previous_run.filters @> '{"classify_topic": true}'::jsonb
                )
            )
              AND t.date_added <= CURRENT_TIMESTAMP
        ), picked AS (
            SELECT * FROM candidates
            ORDER BY is_recent DESC, points DESC, hn_id DESC
            LIMIT 10
        )
        SELECT picked.*,
               row_number() OVER (ORDER BY points DESC, hn_id DESC) AS rank
        FROM picked ORDER BY points DESC, hn_id DESC
    """)
    op.execute("REVOKE ALL ON hacksnap_current_stories FROM PUBLIC")
    # Supabase roles do not exist in ordinary local PostgreSQL test databases.
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                REVOKE ALL ON hacksnap_summaries, hacksnap_current_stories FROM anon;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                REVOKE ALL ON hacksnap_summaries, hacksnap_current_stories FROM authenticated;
            END IF;
        END $$
    """)


def downgrade() -> None:
    op.execute("DROP VIEW hacksnap_current_stories")
    op.drop_table("hacksnap_summaries")
    op.drop_index("hacker_news_threads_last_seen_run_idx", table_name="hacker_news_threads")
    op.drop_column("hacker_news_threads", "last_seen_run_id")

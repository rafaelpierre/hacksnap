"""Record all eligible Hacksnap ranks independently of content snapshots."""

from alembic import op
import sqlalchemy as sa

revision = "0007_rank_history"
down_revision = "0006_recent_first"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "hacksnap_rank_history",
        sa.Column("hn_id", sa.BigInteger(), sa.ForeignKey("hacker_news_threads.hn_id", ondelete="CASCADE"), primary_key=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), primary_key=True),
        sa.Column("rank", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("rank > 0", name="hacksnap_rank_positive"),
    )
    # The composite primary key also supports per-story reverse-time lookups.
    op.execute("ALTER TABLE hacksnap_rank_history ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE VIEW hacksnap_ranked_stories WITH (security_invoker = true) AS
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
              AND NOT EXISTS (
                  SELECT 1 FROM hacksnap_fetch_failures f
                  WHERE f.story_id = t.hn_id AND f.article_url = t.url
              )
        ), picked AS (
            SELECT * FROM candidates
            ORDER BY is_recent DESC, points DESC, hn_id DESC
        )
        SELECT picked.*,
               row_number() OVER (ORDER BY is_recent DESC, points DESC, hn_id DESC) AS rank
        FROM picked ORDER BY is_recent DESC, points DESC, hn_id DESC

    """)
    op.execute("""
        CREATE OR REPLACE VIEW hacksnap_current_stories WITH (security_invoker = true) AS
        SELECT * FROM hacksnap_ranked_stories ORDER BY rank LIMIT 10
    """)
    op.execute("REVOKE ALL ON hacksnap_rank_history, hacksnap_ranked_stories FROM PUBLIC")
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                REVOKE ALL ON hacksnap_rank_history, hacksnap_ranked_stories FROM anon;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                REVOKE ALL ON hacksnap_rank_history, hacksnap_ranked_stories FROM authenticated;
            END IF;
        END $$
    """)


def downgrade() -> None:
    op.execute("""
        CREATE OR REPLACE VIEW hacksnap_current_stories WITH (security_invoker = true) AS
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
              AND NOT EXISTS (
                  SELECT 1 FROM hacksnap_fetch_failures f
                  WHERE f.story_id = t.hn_id AND f.article_url = t.url
              )
        ), picked AS (
            SELECT * FROM candidates
            ORDER BY is_recent DESC, points DESC, hn_id DESC
            LIMIT 10
        )
        SELECT picked.*,
               row_number() OVER (ORDER BY is_recent DESC, points DESC, hn_id DESC) AS rank
        FROM picked ORDER BY is_recent DESC, points DESC, hn_id DESC

    """)
    op.execute("DROP VIEW hacksnap_ranked_stories")
    op.drop_table("hacksnap_rank_history")

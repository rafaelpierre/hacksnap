"""Remember failed article fetches and replace them in the shared leaderboard."""

from alembic import op
import sqlalchemy as sa

revision = "0005_fetch_failures"
down_revision = "0004_hacksnap"
branch_labels = None
depends_on = None


def replace_view(exclude_failures: bool) -> None:
    exclusion = """
        AND NOT EXISTS (
            SELECT 1 FROM hacksnap_fetch_failures f
            WHERE f.story_id = t.hn_id AND f.article_url = t.url
        )
    """ if exclude_failures else ""
    op.execute(f"""
        CREATE OR REPLACE VIEW hacksnap_current_stories WITH (security_invoker = true) AS
        WITH candidates AS (
            SELECT t.*, r.finished_at AS ingestion_finished_at,
                   t.date_added >= CURRENT_TIMESTAMP - INTERVAL '24 hours' AS is_recent
            FROM hacker_news_threads t JOIN hn_ingestion_runs r ON r.run_id = t.last_seen_run_id
            WHERE (
                (r.status = 'succeeded' AND r.filters @> '{{"classify_topic": true}}'::jsonb)
                OR EXISTS (
                    SELECT 1 FROM hn_thread_snapshots s
                    JOIN hn_ingestion_runs previous_run ON previous_run.run_id = s.run_id
                    WHERE s.hn_id = t.hn_id AND previous_run.status = 'succeeded'
                      AND previous_run.filters @> '{{"classify_topic": true}}'::jsonb
                )
            )
              AND t.date_added <= CURRENT_TIMESTAMP
              {exclusion}
        ), picked AS (
            SELECT * FROM candidates
            ORDER BY is_recent DESC, points DESC, hn_id DESC
            LIMIT 10
        )
        SELECT picked.*,
               row_number() OVER (ORDER BY points DESC, hn_id DESC) AS rank
        FROM picked ORDER BY points DESC, hn_id DESC

    """)


def upgrade() -> None:
    op.create_table(
        "hacksnap_fetch_failures",
        sa.Column("story_id", sa.BigInteger(),
                  sa.ForeignKey("hacker_news_threads.hn_id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("article_url", sa.Text(), nullable=False),
        sa.Column("failed_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.func.now()),
    )
    op.execute("ALTER TABLE hacksnap_fetch_failures ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON hacksnap_fetch_failures FROM PUBLIC")
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                REVOKE ALL ON hacksnap_fetch_failures FROM anon;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                REVOKE ALL ON hacksnap_fetch_failures FROM authenticated;
            END IF;
        END $$
    """)
    # Older discussion-only summaries already identify failed article fetches.
    op.execute("""
        INSERT INTO hacksnap_fetch_failures (story_id, article_url)
        SELECT story_id, article_url FROM hacksnap_summaries
        WHERE source_coverage->>'article_status' = 'unavailable'
          AND article_url IS NOT NULL
    """)
    replace_view(True)


def downgrade() -> None:
    replace_view(False)
    op.drop_table("hacksnap_fetch_failures")

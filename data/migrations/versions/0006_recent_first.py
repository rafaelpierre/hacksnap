"""Keep recent stories above archive fallback entries in the final ranking."""

from alembic import op

revision = "0006_recent_first"
down_revision = "0005_fetch_failures"
branch_labels = None
depends_on = None


def replace_view(*, recent_first: bool) -> None:
    ordering = "points DESC, hn_id DESC"
    if recent_first:
        ordering = "is_recent DESC, " + ordering
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
               row_number() OVER (ORDER BY {ordering}) AS rank
        FROM picked ORDER BY {ordering}

    """)


def upgrade() -> None:
    replace_view(recent_first=True)


def downgrade() -> None:
    replace_view(recent_first=False)

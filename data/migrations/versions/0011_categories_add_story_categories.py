"""Persist versioned story categories and expose only their public labels."""
from alembic import op
import sqlalchemy as sa

revision = "0011_categories"
down_revision = "0010_web_reader"
branch_labels = None
depends_on = None

# Freeze the previous projection so adding category never changes existing column positions.
RANKED_VIEW = """CREATE OR REPLACE VIEW hacksnap_ranked_stories WITH (security_invoker = true) AS
        WITH candidates AS (
            SELECT t.hn_id, t.title, t.url, NULL::text AS full_raw_text_contents,
                   t.date_published, t.date_added, t.author, t.points, t.comment_count,
                   t.last_seen_run_id, r.finished_at AS ingestion_finished_at,
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
"""
CURRENT_VIEW = """CREATE OR REPLACE VIEW hacksnap_current_stories
WITH (security_invoker = true) AS
SELECT * FROM hacksnap_ranked_stories ORDER BY rank LIMIT 10"""


def upgrade():
    for name in ("category", "category_version", "category_model", "category_title_hash"):
        op.add_column("hacker_news_threads", sa.Column(name, sa.Text(), nullable=True))
    op.add_column("hacker_news_threads", sa.Column("categorized_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint("hn_category_allowed", "hacker_news_threads",
        "category IN ('models_products','agents_coding','research_evaluation',"
        "'infrastructure_efficiency','safety_privacy','industry_society')")
    op.create_check_constraint("hn_category_metadata", "hacker_news_threads", """
        (category IS NULL AND category_version IS NULL AND category_model IS NULL
            AND categorized_at IS NULL AND category_title_hash IS NULL)
        OR (category IS NOT NULL AND category_version IS NOT NULL AND category_model IS NOT NULL
            AND categorized_at IS NOT NULL AND category_title_hash IS NOT NULL
            AND category_title_hash ~ '^[0-9a-f]{64}$')
    """)
    op.execute("""CREATE INDEX hn_category_date_idx ON hacker_news_threads
        (category, date_added DESC, hn_id DESC) WHERE category IS NOT NULL""")
    op.execute(RANKED_VIEW.replace("AS rank\n", "AS rank,\n"
        "               (SELECT t.category FROM hacker_news_threads t WHERE t.hn_id = picked.hn_id) AS category\n"))
    op.execute(CURRENT_VIEW)
    op.execute("GRANT SELECT (category) ON hacker_news_threads TO hacksnap_reader")


def downgrade():
    op.execute("DROP VIEW hacksnap_current_stories")
    op.execute("DROP VIEW hacksnap_ranked_stories")
    op.execute(RANKED_VIEW)
    op.execute(CURRENT_VIEW)
    op.execute("GRANT SELECT ON hacksnap_current_stories, hacksnap_ranked_stories TO hacksnap_reader")
    op.execute("REVOKE SELECT (category) ON hacker_news_threads FROM hacksnap_reader")
    op.drop_index("hn_category_date_idx", table_name="hacker_news_threads")
    op.drop_constraint("hn_category_metadata", "hacker_news_threads", type_="check")
    op.drop_constraint("hn_category_allowed", "hacker_news_threads", type_="check")
    for name in ("category", "category_version", "category_model", "category_title_hash", "categorized_at"):
        op.drop_column("hacker_news_threads", name)

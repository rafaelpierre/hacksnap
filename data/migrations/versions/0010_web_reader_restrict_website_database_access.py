"""Give the website a narrowly scoped, RLS-enforced database role.

The password and LOGIN are provisioned separately and never stored in migrations.
"""
from alembic import op

revision = "0010_web_reader"
down_revision = "0009_sentiment"
branch_labels = None
depends_on = None

# Column grants keep ingestion diagnostics and raw snapshot payloads private.
READ_COLUMNS = {
    "hacker_news_threads": "hn_id,title,url,date_published,date_added,author,points,comment_count,last_seen_run_id",
    "hn_ingestion_runs": "run_id,status,filters,started_at,finished_at",
    "hn_thread_snapshots": "hn_id,run_id,observed_at",
    "hacksnap_summaries": "story_id,article_summary,article_key_points,discussion_summary,discussion_points,sentiment,overall_takeaway,generated_at,model,source_coverage,updated_at",
    "hacksnap_fetch_failures": "story_id,article_url",
    "hacksnap_rank_history": "hn_id,observed_at,rank",
}


def upgrade():
    op.execute("CREATE ROLE hacksnap_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS")
    op.execute("GRANT USAGE ON SCHEMA public TO hacksnap_reader")
    for table, columns in READ_COLUMNS.items():
        op.execute(f"GRANT SELECT ({columns}) ON public.{table} TO hacksnap_reader")
        op.execute(f"CREATE POLICY hacksnap_web_read ON public.{table} FOR SELECT TO hacksnap_reader USING (true)")
    op.execute("GRANT SELECT ON public.hacksnap_current_stories, public.hacksnap_ranked_stories TO hacksnap_reader")
    op.execute("ALTER ROLE hacksnap_reader SET statement_timeout = '10s'")


def downgrade():
    # Disable fresh connections first; roll back only after moving the website off this role.
    op.execute("ALTER ROLE hacksnap_reader NOLOGIN")
    op.execute("REVOKE SELECT ON public.hacksnap_current_stories, public.hacksnap_ranked_stories FROM hacksnap_reader")
    for table, columns in READ_COLUMNS.items():
        op.execute(f"DROP POLICY hacksnap_web_read ON public.{table}")
        op.execute(f"REVOKE SELECT ({columns}) ON public.{table} FROM hacksnap_reader")
    op.execute("REVOKE USAGE ON SCHEMA public FROM hacksnap_reader")
    op.execute("DROP ROLE hacksnap_reader")

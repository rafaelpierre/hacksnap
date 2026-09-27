"""Delay early cleanup until the retained evidence has a persisted analysis.

No backfill or cleanup at migration time. Existing new-format rows without an
acknowledgement remain retained until a successful refresh or seven-day expiry.
CREATE OR REPLACE preserves the function's existing restricted grants.
"""
from alembic import op
import sqlalchemy as sa

revision = "0013_discussion_retention"
down_revision = "0012_discussion_analysis"
branch_labels = None
depends_on = None


def upgrade():
    # No default, backfill, index or reader grant: this is an internal acknowledgement.
    op.add_column("hacksnap_summaries", sa.Column("discussion_content_hash", sa.Text(), nullable=True))
    op.execute("""
        CREATE OR REPLACE FUNCTION cleanup_hn_contents(batch_size integer DEFAULT 500)
        RETURNS TABLE(contents_deleted bigint, snapshots_cleared bigint)
        LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
        BEGIN
          IF batch_size < 1 OR batch_size > 10000 OR batch_size IS NULL THEN
            RAISE EXCEPTION 'batch_size must be between 1 and 10000';
          END IF;
          WITH candidates AS (
            SELECT c.hn_id FROM public.hn_thread_contents c
            LEFT JOIN public.hacker_news_threads t USING (hn_id)
            WHERE COALESCE(t.date_added, c.fetched_at) < now() - interval '7 days'
               OR EXISTS (SELECT 1 FROM public.hacksnap_summaries s
                  WHERE s.story_id = c.hn_id AND s.article_summary IS NOT NULL
                    AND CASE WHEN s.discussion_analysis IS NULL THEN s.summarized_content_hash
                             ELSE s.discussion_content_hash END = c.content_hash)
            ORDER BY c.hn_id LIMIT batch_size FOR UPDATE OF c SKIP LOCKED
          ), removed AS (
            DELETE FROM public.hn_thread_contents c USING candidates x
            WHERE c.hn_id = x.hn_id RETURNING c.hn_id
          ) SELECT count(*) INTO contents_deleted FROM removed;
          WITH candidates AS (
            SELECT p.snapshot_id FROM public.hn_thread_snapshots p
            LEFT JOIN public.hacker_news_threads t USING (hn_id)
            WHERE p.raw_payload IS NOT NULL AND (
              t.date_added < now() - interval '7 days'
              OR p.observed_at < now() - interval '7 days'
              OR EXISTS (SELECT 1 FROM public.hacksnap_summaries s
                  WHERE s.story_id = p.hn_id AND s.article_summary IS NOT NULL
                    AND (s.discussion_analysis IS NULL OR
                         s.discussion_content_hash =
                         public.hn_source_hash(p.raw_payload))))
            ORDER BY p.snapshot_id LIMIT batch_size FOR UPDATE OF p SKIP LOCKED
          ), cleared AS (
            UPDATE public.hn_thread_snapshots p SET raw_payload = NULL
            FROM candidates x WHERE p.snapshot_id = x.snapshot_id RETURNING p.snapshot_id
          ) SELECT count(*) INTO snapshots_cleared FROM cleared;
          RETURN NEXT;
        END $$
    """)


def downgrade():
    op.execute("""
        CREATE OR REPLACE FUNCTION cleanup_hn_contents(batch_size integer DEFAULT 500)
        RETURNS TABLE(contents_deleted bigint, snapshots_cleared bigint)
        LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
        BEGIN
          IF batch_size < 1 OR batch_size > 10000 OR batch_size IS NULL THEN
            RAISE EXCEPTION 'batch_size must be between 1 and 10000';
          END IF;
          WITH candidates AS (
            SELECT c.hn_id FROM public.hn_thread_contents c
            LEFT JOIN public.hacker_news_threads t USING (hn_id)
            WHERE COALESCE(t.date_added, c.fetched_at) < now() - interval '7 days'
               OR EXISTS (SELECT 1 FROM public.hacksnap_summaries s
                  WHERE s.story_id = c.hn_id AND s.article_summary IS NOT NULL
                    AND s.summarized_content_hash = c.content_hash)
            ORDER BY c.hn_id LIMIT batch_size FOR UPDATE OF c SKIP LOCKED
          ), removed AS (
            DELETE FROM public.hn_thread_contents c USING candidates x
            WHERE c.hn_id = x.hn_id RETURNING c.hn_id
          ) SELECT count(*) INTO contents_deleted FROM removed;
          WITH candidates AS (
            SELECT p.snapshot_id FROM public.hn_thread_snapshots p
            LEFT JOIN public.hacker_news_threads t USING (hn_id)
            WHERE p.raw_payload IS NOT NULL AND (
              t.date_added < now() - interval '7 days'
              OR p.observed_at < now() - interval '7 days'
              OR EXISTS (SELECT 1 FROM public.hacksnap_summaries s
                  WHERE s.story_id = p.hn_id AND s.article_summary IS NOT NULL))
            ORDER BY p.snapshot_id LIMIT batch_size FOR UPDATE OF p SKIP LOCKED
          ), cleared AS (
            UPDATE public.hn_thread_snapshots p SET raw_payload = NULL
            FROM candidates x WHERE p.snapshot_id = x.snapshot_id RETURNING p.snapshot_id
          ) SELECT count(*) INTO snapshots_cleared FROM cleared;
          RETURN NEXT;
        END $$
    """)

    op.drop_column("hacksnap_summaries", "discussion_content_hash")

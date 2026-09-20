"""Separate permanent HN identities from disposable source content.

Deploy collector, enrichment worker and MCP together with this migration.
No retention cleanup runs during migration.
"""
from alembic import op
import sqlalchemy as sa

revision = "0008_disposable_contents"
down_revision = "0007_rank_history"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE TABLE hn_items (hn_id bigint PRIMARY KEY)")
    op.execute("INSERT INTO hn_items SELECT hn_id FROM hacker_news_threads")
    for table, column in (("hacksnap_summaries", "story_id"),
                          ("hn_thread_snapshots", "hn_id"),
                          ("hacksnap_rank_history", "hn_id"),
                          ("hacksnap_fetch_failures", "story_id")):
        op.drop_constraint(f"{table}_{column}_fkey", table, type_="foreignkey")
        op.create_foreign_key(f"{table}_{column}_fkey", table, "hn_items", [column], ["hn_id"])
    op.create_foreign_key("hacker_news_threads_hn_id_fkey", "hacker_news_threads", "hn_items", ["hn_id"], ["hn_id"])
    op.execute("""
        CREATE FUNCTION hn_source_hash(payload jsonb) RETURNS text
        LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
        SET search_path = pg_catalog AS $$
          SELECT encode(sha256(convert_to(jsonb_build_object(
            'story', jsonb_build_object('title', payload->'story'->'title',
                'url', payload->'story'->'url', 'text', payload->'story'->'text'),
            'comments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', c->'item'->'id', 'parent', c->'item'->'parent',
                'text', c->'item'->'text', 'by', c->'item'->'by',
                'deleted', c->'item'->'deleted', 'dead', c->'item'->'dead',
                'depth', c->'depth') ORDER BY (c->'item'->>'id')::bigint)
                FROM jsonb_array_elements(payload->'comments') c), '[]'::jsonb)
          )::text, 'UTF8')), 'hex')
        $$
    """)
    op.execute("""
        CREATE TABLE hn_thread_contents (
          hn_id bigint PRIMARY KEY REFERENCES hn_items(hn_id),
          full_raw_text_contents text NOT NULL,
          content_hash text NOT NULL,
          fetched_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        INSERT INTO hn_thread_contents(hn_id, full_raw_text_contents, content_hash)
        SELECT hn_id, full_raw_text_contents, hn_source_hash(full_raw_text_contents::jsonb)
        FROM hacker_news_threads
    """)
    op.add_column("hacksnap_summaries", sa.Column("summarized_content_hash", sa.Text(), nullable=True))
    op.alter_column("hn_thread_snapshots", "raw_payload", nullable=True)
    op.create_index("hn_thread_snapshots_retained_idx", "hn_thread_snapshots", ["snapshot_id"],
                    postgresql_where=sa.text("raw_payload IS NOT NULL"))
    op.execute("""
        CREATE OR REPLACE VIEW hacksnap_ranked_stories WITH (security_invoker = true) AS
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

        """)
    op.drop_column("hacker_news_threads", "full_raw_text_contents")
    for table in ("hn_items", "hn_thread_contents"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"REVOKE ALL ON {table} FROM PUBLIC")
    op.execute("""
        CREATE FUNCTION cleanup_hn_contents(batch_size integer DEFAULT 500)
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
    op.execute("REVOKE ALL ON FUNCTION cleanup_hn_contents(integer), hn_source_hash(jsonb) FROM PUBLIC")
    op.execute("""
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
          REVOKE ALL ON hn_items, hn_thread_contents FROM anon;
          REVOKE ALL ON FUNCTION cleanup_hn_contents(integer), hn_source_hash(jsonb) FROM anon;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
          REVOKE ALL ON hn_items, hn_thread_contents FROM authenticated;
          REVOKE ALL ON FUNCTION cleanup_hn_contents(integer), hn_source_hash(jsonb) FROM authenticated;
        END IF;
      END $$
    """)


def downgrade():
    raise RuntimeError("Restore a pre-migration backup: purged source contents cannot be reconstructed.")

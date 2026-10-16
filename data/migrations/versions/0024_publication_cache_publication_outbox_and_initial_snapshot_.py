"""publication outbox and initial snapshot reader grants

Revision ID: 0024_publication_cache
Revises: 0023_editorial_titles
Create Date: 2026-10-15 12:02:15.544987
"""

from alembic import op


revision = "0024_publication_cache"
down_revision = "0023_editorial_titles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("GRANT SELECT (snapshot_id, score, descendants) ON public.hn_thread_snapshots TO hacksnap_reader")
    op.execute("""
        CREATE TABLE public.hacksnap_publication_outbox (
            event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            story_id bigint NOT NULL,
            kind text NOT NULL CHECK (kind IN ('publication', 'correction', 'image', 'removal')),
            created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
            attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
            lease_id uuid,
            delivered_at timestamptz
        );
        CREATE INDEX hacksnap_publication_pending
            ON public.hacksnap_publication_outbox (available_at, event_id)
            WHERE delivered_at IS NULL;
        ALTER TABLE public.hacksnap_publication_outbox ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON public.hacksnap_publication_outbox FROM PUBLIC, hacksnap_reader;
        REVOKE ALL ON SEQUENCE public.hacksnap_publication_outbox_event_id_seq FROM PUBLIC, hacksnap_reader;
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
                REVOKE ALL ON public.hacksnap_publication_outbox FROM anon;
                REVOKE ALL ON SEQUENCE public.hacksnap_publication_outbox_event_id_seq FROM anon;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
                REVOKE ALL ON public.hacksnap_publication_outbox FROM authenticated;
                REVOKE ALL ON SEQUENCE public.hacksnap_publication_outbox_event_id_seq FROM authenticated;
            END IF;
        END $$;
    """)
    # The existing pipeline connects as the database owner. No website write
    # privilege or SECURITY DEFINER function is introduced.
    op.execute("""
        CREATE FUNCTION public.hacksnap_notify_summary() RETURNS trigger
        LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
        DECLARE
            was_public boolean := false;
            is_public boolean := false;
            change_kind text;
        BEGIN
            IF TG_OP <> 'INSERT' THEN
                was_public := COALESCE(OLD.overall_takeaway ~ '[^[:space:]]', false)
                    AND COALESCE(OLD.source_coverage->>'article_status', '') <> 'unavailable';
            END IF;
            IF TG_OP <> 'DELETE' THEN
                is_public := COALESCE(NEW.overall_takeaway ~ '[^[:space:]]', false)
                    AND COALESCE(NEW.source_coverage->>'article_status', '') <> 'unavailable';
            END IF;
            IF was_public AND NOT is_public THEN change_kind := 'removal';
            ELSIF is_public AND NOT was_public THEN change_kind := 'publication';
            ELSIF is_public AND ROW(OLD.title, OLD.article_summary, OLD.article_key_points,
                OLD.discussion_summary, OLD.discussion_points, OLD.overall_takeaway,
                OLD.sentiment, OLD.source_coverage, OLD.discussion_analysis,
                OLD.discussion_analyzed_at, OLD.discussion_analysis_coverage)
                IS DISTINCT FROM ROW(NEW.title, NEW.article_summary, NEW.article_key_points,
                NEW.discussion_summary, NEW.discussion_points, NEW.overall_takeaway,
                NEW.sentiment, NEW.source_coverage, NEW.discussion_analysis,
                NEW.discussion_analyzed_at, NEW.discussion_analysis_coverage)
                THEN change_kind := 'correction';
            END IF;
            IF change_kind IS NOT NULL THEN
                INSERT INTO public.hacksnap_publication_outbox (story_id, kind)
                    VALUES (COALESCE(NEW.story_id, OLD.story_id), change_kind);
            END IF;
            RETURN NULL;
        END $$;
        REVOKE ALL ON FUNCTION public.hacksnap_notify_summary() FROM PUBLIC;
        CREATE TRIGGER hacksnap_summary_publication
            AFTER INSERT OR UPDATE OR DELETE ON public.hacksnap_summaries
            FOR EACH ROW EXECUTE FUNCTION public.hacksnap_notify_summary();

        CREATE FUNCTION public.hacksnap_notify_thread() RETURNS trigger
        LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
        DECLARE change_kind text;
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM public.hacksnap_summaries
                WHERE story_id = OLD.hn_id AND overall_takeaway ~ '[^[:space:]]'
                AND COALESCE(source_coverage->>'article_status', '') <> 'unavailable') THEN
                IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
                RETURN NEW;
            END IF;
            IF TG_OP = 'DELETE' THEN change_kind := 'removal';
            ELSIF ROW(OLD.title, OLD.url, OLD.category, OLD.story_slug, OLD.date_added)
                IS DISTINCT FROM ROW(NEW.title, NEW.url, NEW.category, NEW.story_slug, NEW.date_added)
                THEN change_kind := 'correction';
            ELSIF (CASE WHEN OLD.image_status = 'ready'
                AND OLD.image_source_type IN ('og', 'twitter', 'json_ld')
                THEN ROW(OLD.image_url, OLD.image_width, OLD.image_height, OLD.image_mime_type) END)
                IS DISTINCT FROM (CASE WHEN NEW.image_status = 'ready'
                AND NEW.image_source_type IN ('og', 'twitter', 'json_ld')
                THEN ROW(NEW.image_url, NEW.image_width, NEW.image_height, NEW.image_mime_type) END)
                THEN change_kind := 'image';
            END IF;
            IF change_kind IS NOT NULL THEN
                INSERT INTO public.hacksnap_publication_outbox (story_id, kind)
                    VALUES (OLD.hn_id, change_kind);
            END IF;
            IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
            RETURN NEW;
        END $$;
        REVOKE ALL ON FUNCTION public.hacksnap_notify_thread() FROM PUBLIC;
        CREATE TRIGGER hacksnap_thread_publication
            BEFORE UPDATE OR DELETE ON public.hacker_news_threads
            FOR EACH ROW EXECUTE FUNCTION public.hacksnap_notify_thread();

        CREATE FUNCTION public.hacksnap_notify_withdrawal() RETURNS trigger
        LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
        DECLARE id bigint := COALESCE(NEW.story_id, OLD.story_id);
        BEGIN
            IF EXISTS (SELECT 1 FROM public.hacksnap_summaries
                WHERE story_id = id AND overall_takeaway ~ '[^[:space:]]') THEN
                INSERT INTO public.hacksnap_publication_outbox (story_id, kind)
                    VALUES (id, CASE WHEN TG_OP = 'DELETE' THEN 'correction' ELSE 'removal' END);
            END IF;
            RETURN NULL;
        END $$;
        REVOKE ALL ON FUNCTION public.hacksnap_notify_withdrawal() FROM PUBLIC;
        CREATE TRIGGER hacksnap_fetch_withdrawal
            AFTER INSERT OR UPDATE OR DELETE ON public.hacksnap_fetch_failures
            FOR EACH ROW EXECUTE FUNCTION public.hacksnap_notify_withdrawal();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER hacksnap_fetch_withdrawal ON public.hacksnap_fetch_failures")
    op.execute("DROP TRIGGER hacksnap_thread_publication ON public.hacker_news_threads")
    op.execute("DROP TRIGGER hacksnap_summary_publication ON public.hacksnap_summaries")
    for name in ("withdrawal", "thread", "summary"):
        op.execute(f"DROP FUNCTION public.hacksnap_notify_{name}()")
    op.drop_table("hacksnap_publication_outbox")
    op.execute("REVOKE SELECT (snapshot_id, score, descendants) ON public.hn_thread_snapshots FROM hacksnap_reader")

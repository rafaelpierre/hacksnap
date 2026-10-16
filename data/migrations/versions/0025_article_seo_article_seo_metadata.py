"""article SEO metadata

Revision ID: 0025_article_seo
Revises: 0024_publication_cache
Create Date: 2026-10-16 13:16:31.815240
"""

from alembic import op


revision = '0025_article_seo'
down_revision = '0024_publication_cache'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(r"""
        ALTER TABLE public.hacksnap_summaries
            ADD COLUMN seo_title text,
            ADD COLUMN seo_description text,
            ADD COLUMN seo_metadata jsonb,
            ADD COLUMN seo_input_version bigint NOT NULL DEFAULT 0,
            ADD COLUMN seo_pending boolean NOT NULL DEFAULT false,
            ADD COLUMN seo_attempted_at timestamptz,
            ADD CONSTRAINT hacksnap_seo_copy_check CHECK (
                (seo_title IS NULL AND seo_description IS NULL AND seo_metadata IS NULL) OR
                (seo_title IS NOT NULL AND seo_description IS NOT NULL AND seo_metadata IS NOT NULL
                 AND char_length(seo_title) BETWEEN 1 AND 160
                 AND char_length(seo_description) BETWEEN 1 AND 300
                 AND seo_title ~ '[^[:space:]]' AND seo_description ~ '[^[:space:]]'
                 AND seo_title !~ E'[\r\n]' AND seo_description !~ E'[\r\n]'
                 AND jsonb_typeof(seo_metadata) = 'object'));
        GRANT SELECT (seo_title, seo_description) ON public.hacksnap_summaries TO hacksnap_reader;
        CREATE INDEX hacksnap_seo_pending ON public.hacksnap_summaries (seo_attempted_at NULLS FIRST, story_id DESC)
            WHERE seo_pending;

        CREATE FUNCTION public.hacksnap_invalidate_seo() RETURNS trigger
        LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
        BEGIN
            IF TG_OP = 'INSERT' THEN
                NEW.seo_pending := true;
            ELSIF ROW(OLD.title, OLD.article_summary, OLD.article_key_points,
                      OLD.overall_takeaway, OLD.discussion_points,
                      OLD.source_coverage->>'article_status') IS DISTINCT FROM
                  ROW(NEW.title, NEW.article_summary, NEW.article_key_points,
                      NEW.overall_takeaway, NEW.discussion_points,
                      NEW.source_coverage->>'article_status') THEN
                NEW.seo_title := NULL;
                NEW.seo_description := NULL;
                NEW.seo_metadata := NULL;
                NEW.seo_pending := true;
                NEW.seo_attempted_at := NULL;
                NEW.seo_input_version := OLD.seo_input_version + 1;
            END IF;
            RETURN NEW;
        END $$;
        REVOKE ALL ON FUNCTION public.hacksnap_invalidate_seo() FROM PUBLIC;
        CREATE TRIGGER hacksnap_seo_inputs BEFORE INSERT OR UPDATE
            ON public.hacksnap_summaries FOR EACH ROW
            EXECUTE FUNCTION public.hacksnap_invalidate_seo();

        CREATE FUNCTION public.hacksnap_invalidate_title_seo() RETURNS trigger
        LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
        BEGIN
            UPDATE public.hacksnap_summaries SET seo_title = NULL, seo_description = NULL,
                seo_metadata = NULL, seo_pending = true, seo_attempted_at = NULL,
                seo_input_version = seo_input_version + 1 WHERE story_id = NEW.hn_id;
            RETURN NEW;
        END $$;
        REVOKE ALL ON FUNCTION public.hacksnap_invalidate_title_seo() FROM PUBLIC;
        CREATE TRIGGER hacksnap_seo_original_title AFTER UPDATE OF title
            ON public.hacker_news_threads FOR EACH ROW
            WHEN (OLD.title IS DISTINCT FROM NEW.title)
            EXECUTE FUNCTION public.hacksnap_invalidate_title_seo();

        CREATE FUNCTION public.hacksnap_notify_seo() RETURNS trigger
        LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
        BEGIN
            IF NEW.overall_takeaway ~ '[^[:space:]]'
                AND COALESCE(NEW.source_coverage->>'article_status', '') <> 'unavailable' THEN
                INSERT INTO public.hacksnap_publication_outbox (story_id, kind)
                    VALUES (NEW.story_id, 'correction');
            END IF;
            RETURN NULL;
        END $$;
        REVOKE ALL ON FUNCTION public.hacksnap_notify_seo() FROM PUBLIC;
        CREATE TRIGGER hacksnap_seo_publication AFTER UPDATE ON public.hacksnap_summaries
            FOR EACH ROW WHEN (ROW(OLD.seo_title, OLD.seo_description) IS DISTINCT FROM
                               ROW(NEW.seo_title, NEW.seo_description))
            EXECUTE FUNCTION public.hacksnap_notify_seo();
    """)


def downgrade() -> None:
    op.execute("""
        DROP TRIGGER hacksnap_seo_publication ON public.hacksnap_summaries;
        DROP TRIGGER hacksnap_seo_original_title ON public.hacker_news_threads;
        DROP TRIGGER hacksnap_seo_inputs ON public.hacksnap_summaries;
        DROP FUNCTION public.hacksnap_notify_seo();
        DROP FUNCTION public.hacksnap_invalidate_title_seo();
        DROP FUNCTION public.hacksnap_invalidate_seo();
        DROP INDEX public.hacksnap_seo_pending;
        ALTER TABLE public.hacksnap_summaries DROP CONSTRAINT hacksnap_seo_copy_check,
            DROP COLUMN seo_title, DROP COLUMN seo_description, DROP COLUMN seo_metadata,
            DROP COLUMN seo_input_version, DROP COLUMN seo_pending, DROP COLUMN seo_attempted_at;
    """)

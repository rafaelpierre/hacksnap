"""Keep historical GA views and first-party story events separately."""

from alembic import op

revision = "0019_story_popularity"
down_revision = "0018_discussion_themes_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE public.hacksnap_story_popularity (
            story_id bigint PRIMARY KEY REFERENCES public.hacker_news_threads(hn_id) ON DELETE CASCADE,
            historical_views bigint NOT NULL DEFAULT 0 CHECK (historical_views >= 0),
            story_views bigint NOT NULL DEFAULT 0 CHECK (story_views >= 0),
            story_clicks bigint NOT NULL DEFAULT 0 CHECK (story_clicks >= 0),
            historical_source text,
            historical_imported_at timestamptz,
            historical_through timestamptz
        );
        CREATE INDEX hacksnap_popularity_rank_idx ON public.hacksnap_story_popularity
            ((historical_views::numeric + story_views::numeric) DESC, story_id DESC);
        CREATE TABLE public.hacksnap_popularity_events (
            visit_id uuid NOT NULL,
            story_id bigint NOT NULL REFERENCES public.hacker_news_threads(hn_id) ON DELETE CASCADE,
            kind text NOT NULL CHECK (kind IN ('view', 'click')),
            received_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (visit_id, story_id, kind)
        );
        CREATE INDEX hacksnap_popularity_event_story_idx
            ON public.hacksnap_popularity_events(story_id);
        ALTER TABLE public.hacksnap_story_popularity ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.hacksnap_popularity_events ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON public.hacksnap_story_popularity, public.hacksnap_popularity_events
            FROM PUBLIC, anon, authenticated;
        CREATE ROLE hacksnap_counter NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        GRANT USAGE ON SCHEMA public TO hacksnap_counter;
        ALTER ROLE hacksnap_counter SET statement_timeout = '5s';
        GRANT SELECT (hn_id, date_added) ON public.hacker_news_threads TO hacksnap_counter;
        CREATE POLICY hacksnap_counter_read ON public.hacker_news_threads
            FOR SELECT TO hacksnap_counter USING (true);
        GRANT SELECT (story_id, historical_views, story_views)
            ON public.hacksnap_story_popularity TO hacksnap_reader;
        CREATE POLICY hacksnap_web_read ON public.hacksnap_story_popularity
            FOR SELECT TO hacksnap_reader USING (true);
        GRANT SELECT (story_id, story_views, story_clicks),
            INSERT (story_id, story_views, story_clicks), UPDATE (story_views, story_clicks)
            ON public.hacksnap_story_popularity TO hacksnap_counter;
        CREATE POLICY hacksnap_counter_read ON public.hacksnap_story_popularity
            FOR SELECT TO hacksnap_counter USING (true);
        CREATE POLICY hacksnap_counter_insert ON public.hacksnap_story_popularity
            FOR INSERT TO hacksnap_counter WITH CHECK (true);
        CREATE POLICY hacksnap_counter_update ON public.hacksnap_story_popularity
            FOR UPDATE TO hacksnap_counter USING (true) WITH CHECK (true);
        GRANT SELECT (visit_id, story_id, kind), INSERT (visit_id, story_id, kind)
            ON public.hacksnap_popularity_events TO hacksnap_counter;
        CREATE POLICY hacksnap_counter_read ON public.hacksnap_popularity_events
            FOR SELECT TO hacksnap_counter USING (true);
        CREATE POLICY hacksnap_counter_insert ON public.hacksnap_popularity_events
            FOR INSERT TO hacksnap_counter WITH CHECK (
                EXISTS (SELECT 1 FROM public.hacker_news_threads t
                        WHERE t.hn_id = hacksnap_popularity_events.story_id
                          AND t.hn_id BETWEEN 1 AND 999999999999999
                          AND t.date_added <= CURRENT_TIMESTAMP)
            );
    """)


def downgrade() -> None:
    # Disable new connections first. The caller must retire the writer before rollback.
    op.execute("ALTER ROLE hacksnap_counter NOLOGIN")
    op.execute("DROP TABLE public.hacksnap_popularity_events")
    op.execute("DROP TABLE public.hacksnap_story_popularity")
    op.execute("DROP POLICY hacksnap_counter_read ON public.hacker_news_threads")
    op.execute("REVOKE SELECT (hn_id, date_added) ON public.hacker_news_threads FROM hacksnap_counter")
    op.execute("REVOKE USAGE ON SCHEMA public FROM hacksnap_counter")
    op.execute("DROP ROLE hacksnap_counter")

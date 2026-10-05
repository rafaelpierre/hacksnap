"""Freeze historical imports once first-party collection has been activated.

For an already-used counter, the recorded timestamp is when this migration
locked the historical baseline; it does not reconstruct the original start time.
"""

from alembic import op

revision = "0020_story_popularity_activation"
down_revision = "0019_story_popularity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        LOCK TABLE public.hacksnap_popularity_events, public.hacksnap_story_popularity
            IN SHARE ROW EXCLUSIVE MODE;
        CREATE TABLE public.hacksnap_popularity_state (
            singleton boolean PRIMARY KEY CHECK (singleton),
            tracking_started_at timestamptz
        );
        INSERT INTO public.hacksnap_popularity_state(singleton, tracking_started_at)
        SELECT true, CASE WHEN
            EXISTS (SELECT 1 FROM public.hacksnap_popularity_events)
            OR EXISTS (SELECT 1 FROM public.hacksnap_story_popularity
                       WHERE story_views > 0 OR story_clicks > 0)
            OR EXISTS (SELECT 1 FROM pg_roles
                       WHERE rolname = 'hacksnap_counter' AND rolcanlogin)
            THEN clock_timestamp() ELSE NULL END;
        ALTER TABLE public.hacksnap_popularity_state ENABLE ROW LEVEL SECURITY;
        REVOKE ALL ON public.hacksnap_popularity_state FROM PUBLIC, anon, authenticated;
        GRANT SELECT (singleton, tracking_started_at)
            ON public.hacksnap_popularity_state TO hacksnap_counter;
        CREATE POLICY hacksnap_counter_read ON public.hacksnap_popularity_state
            FOR SELECT TO hacksnap_counter USING (true);
    """)


def downgrade() -> None:
    # Retire the marker-aware writer first. Original counters and privileges remain.
    op.execute("DROP TABLE public.hacksnap_popularity_state")

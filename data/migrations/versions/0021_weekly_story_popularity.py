"""Allow recent view rankings without exposing visit identifiers."""

from alembic import op

revision = "0021_weekly_story_popularity"
down_revision = "0020_story_popularity_activation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE INDEX hacksnap_popularity_recent_views_idx
            ON public.hacksnap_popularity_events(received_at, story_id)
            WHERE kind = 'view';
        GRANT SELECT (story_id, kind, received_at)
            ON public.hacksnap_popularity_events TO hacksnap_reader;
        CREATE POLICY hacksnap_web_recent_views ON public.hacksnap_popularity_events
            FOR SELECT TO hacksnap_reader USING (kind = 'view');
    """)


def downgrade() -> None:
    op.execute("""
        DROP POLICY hacksnap_web_recent_views ON public.hacksnap_popularity_events;
        REVOKE SELECT (story_id, kind, received_at)
            ON public.hacksnap_popularity_events FROM hacksnap_reader;
        DROP INDEX public.hacksnap_popularity_recent_views_idx;
    """)

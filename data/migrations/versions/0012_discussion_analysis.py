"""Persist complete discussion analyses and expose only public coverage.

No backfill: existing rows retain NULL in every new column. Detailed citation and
stance validation belongs to the versioned application contract; these checks
protect the storage envelope and cross-column consistency for every writer.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0012_discussion_analysis"
down_revision = "0011_categories"
branch_labels = None
depends_on = None


def upgrade():
    for name in ("discussion_analysis", "discussion_analysis_metadata"):
        op.add_column("hacksnap_summaries", sa.Column(name, postgresql.JSONB(), nullable=True))
    op.add_column("hacksnap_summaries", sa.Column(
        "discussion_analyzed_at", sa.DateTime(timezone=True), nullable=True,
    ))
    # Explicit allowlist: a future metadata field cannot silently become public.
    op.add_column("hacksnap_summaries", sa.Column(
        "discussion_analysis_coverage", postgresql.JSONB(), sa.Computed(
            "discussion_analysis_metadata -> 'coverage'", persisted=True,
        ), nullable=True,
    ))
    op.create_check_constraint("hacksnap_analysis_complete", "hacksnap_summaries", """
        (discussion_analysis IS NULL AND discussion_analysis_metadata IS NULL
            AND discussion_analyzed_at IS NULL)
        OR (discussion_analysis IS NOT NULL AND discussion_analysis_metadata IS NOT NULL
            AND discussion_analyzed_at IS NOT NULL)
    """)
    # IS TRUE is intentional: CHECK otherwise accepts SQL NULL from missing JSON keys.
    op.create_check_constraint("hacksnap_analysis_shape", "hacksnap_summaries", """
        discussion_analysis IS NULL OR (
            jsonb_typeof(discussion_analysis) = 'object'
            AND discussion_analysis ?& ARRAY['status','reference_claims','critical_comments',
                                             'supportive_comments','topics']
            AND discussion_analysis - ARRAY['status','reference_claims','critical_comments',
                                             'supportive_comments','topics'] = '{}'::jsonb
            AND discussion_analysis ->> 'status' IN ('available','no_comments','insufficient_context')
            AND jsonb_typeof(discussion_analysis -> 'reference_claims') = 'array'
            AND jsonb_array_length(discussion_analysis -> 'reference_claims') <= 6
            AND jsonb_typeof(discussion_analysis -> 'critical_comments') = 'array'
            AND jsonb_array_length(discussion_analysis -> 'critical_comments') <= 3
            AND jsonb_typeof(discussion_analysis -> 'supportive_comments') = 'array'
            AND jsonb_array_length(discussion_analysis -> 'supportive_comments') <= 3
            AND jsonb_typeof(discussion_analysis -> 'topics') = 'array'
            AND jsonb_array_length(discussion_analysis -> 'topics') <= 6
            AND (discussion_analysis ->> 'status' <> 'available'
                 OR jsonb_array_length(discussion_analysis -> 'reference_claims') > 0)
            AND (discussion_analysis ->> 'status' <> 'no_comments'
                 OR (discussion_analysis -> 'critical_comments' = '[]'::jsonb
                     AND discussion_analysis -> 'supportive_comments' = '[]'::jsonb
                     AND discussion_analysis -> 'topics' = '[]'::jsonb))
            AND (discussion_analysis ->> 'status' <> 'insufficient_context'
                 OR (discussion_analysis -> 'reference_claims' = '[]'::jsonb
                     AND discussion_analysis -> 'critical_comments' = '[]'::jsonb
                     AND discussion_analysis -> 'supportive_comments' = '[]'::jsonb))
        ) IS TRUE
    """)
    op.create_check_constraint("hacksnap_analysis_metadata", "hacksnap_summaries", """
        discussion_analysis_metadata IS NULL OR (
            jsonb_typeof(discussion_analysis_metadata) = 'object'
            AND discussion_analysis_metadata -> 'schema_version' = '"1"'::jsonb
            AND jsonb_typeof(discussion_analysis_metadata -> 'prompt_version') = 'string'
            AND length(btrim(discussion_analysis_metadata ->> 'prompt_version')) BETWEEN 1 AND 160
            AND jsonb_typeof(discussion_analysis_metadata -> 'model') = 'string'
            AND length(btrim(discussion_analysis_metadata ->> 'model')) BETWEEN 1 AND 160
            AND jsonb_typeof(discussion_analysis_metadata -> 'source_version') = 'string'
            AND discussion_analysis_metadata ->> 'source_version' ~ '^[a-f0-9]{64}$'
            AND jsonb_typeof(discussion_analysis_metadata -> 'input_fingerprint') = 'string'
            AND discussion_analysis_metadata ->> 'input_fingerprint' ~ '^[a-f0-9]{64}$'
            AND jsonb_typeof(discussion_analysis_metadata -> 'analyzed_at') = 'string'
            AND discussion_analysis_metadata ->> 'analyzed_at' ~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
            AND (discussion_analysis_metadata ->> 'analyzed_at')::timestamptz = discussion_analyzed_at
            AND jsonb_typeof(discussion_analysis_metadata -> 'coverage') = 'object'
            AND (discussion_analysis_metadata -> 'coverage')
                - ARRAY['stored_comments','included_comments','comments_truncated','selection_method']
                = '{}'::jsonb
            AND jsonb_typeof(discussion_analysis_metadata #> '{coverage,stored_comments}') = 'number'
            AND discussion_analysis_metadata #>> '{coverage,stored_comments}' ~ '^[0-9]+$'
            AND jsonb_typeof(discussion_analysis_metadata #> '{coverage,included_comments}') = 'number'
            AND discussion_analysis_metadata #>> '{coverage,included_comments}' ~ '^[0-9]+$'
            AND (discussion_analysis_metadata #>> '{coverage,included_comments}')::numeric
                <= (discussion_analysis_metadata #>> '{coverage,stored_comments}')::numeric
            AND jsonb_typeof(discussion_analysis_metadata #> '{coverage,comments_truncated}') = 'boolean'
            AND (discussion_analysis_metadata #>> '{coverage,comments_truncated}')::boolean = (
                (discussion_analysis_metadata #>> '{coverage,included_comments}')::numeric
                < (discussion_analysis_metadata #>> '{coverage,stored_comments}')::numeric)
            AND discussion_analysis_metadata #>> '{coverage,selection_method}'
                = 'active_branches_with_ancestors_v1'
            AND (discussion_analysis ->> 'status' = 'no_comments') = (
                (discussion_analysis_metadata #>> '{coverage,included_comments}')::numeric = 0)
        ) IS TRUE
    """)
    op.execute("""GRANT SELECT (discussion_analysis, discussion_analyzed_at,
                  discussion_analysis_coverage) ON hacksnap_summaries TO hacksnap_reader""")


def downgrade():
    op.execute("""REVOKE SELECT (discussion_analysis, discussion_analyzed_at,
                  discussion_analysis_coverage) ON hacksnap_summaries FROM hacksnap_reader""")
    for name in ("hacksnap_analysis_metadata", "hacksnap_analysis_shape", "hacksnap_analysis_complete"):
        op.drop_constraint(name, "hacksnap_summaries", type_="check")
    for name in ("discussion_analysis_coverage", "discussion_analyzed_at",
                 "discussion_analysis_metadata", "discussion_analysis"):
        op.drop_column("hacksnap_summaries", name)

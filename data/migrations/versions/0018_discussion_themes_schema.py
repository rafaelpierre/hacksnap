"""Allow theme-only discussion analysis while preserving historical v1 rows.

Replace the two version-dependent checks in one transactional migration. Existing
v1 rows remain valid; v2 rows have no reference claims or stance highlights.
"""

from alembic import op

revision = "0018_discussion_themes_schema"
down_revision = "0017_archive_order"
branch_labels = None
depends_on = None


def _shape_constraint(v2: bool) -> str:
    if v2:
        available_claims = """
            AND (discussion_analysis ->> 'status' <> 'available'
                 OR discussion_analysis_metadata ->> 'schema_version' = '2'
                 OR jsonb_array_length(discussion_analysis -> 'reference_claims') > 0)
        """
        theme_only = """
            AND (discussion_analysis_metadata ->> 'schema_version' <> '2'
                 OR (discussion_analysis ->> 'status' IN ('available','no_comments')
                     AND discussion_analysis -> 'reference_claims' = '[]'::jsonb
                     AND discussion_analysis -> 'critical_comments' = '[]'::jsonb
                     AND discussion_analysis -> 'supportive_comments' = '[]'::jsonb))
        """
    else:
        available_claims = """
            AND (discussion_analysis ->> 'status' <> 'available'
                 OR jsonb_array_length(discussion_analysis -> 'reference_claims') > 0)
        """
        theme_only = ""
    return (
        """
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
            """
        + available_claims
        + theme_only
        + """
            AND (discussion_analysis ->> 'status' <> 'no_comments'
                 OR (discussion_analysis -> 'critical_comments' = '[]'::jsonb
                     AND discussion_analysis -> 'supportive_comments' = '[]'::jsonb
                     AND discussion_analysis -> 'topics' = '[]'::jsonb))
            AND (discussion_analysis ->> 'status' <> 'insufficient_context'
                 OR (discussion_analysis -> 'reference_claims' = '[]'::jsonb
                     AND discussion_analysis -> 'critical_comments' = '[]'::jsonb
                     AND discussion_analysis -> 'supportive_comments' = '[]'::jsonb))
        ) IS TRUE
    """
    )


def _metadata_constraint(v2: bool) -> str:
    versions = "IN ('\"1\"'::jsonb,'\"2\"'::jsonb)" if v2 else "= '\"1\"'::jsonb"
    return (
        """
        discussion_analysis_metadata IS NULL OR (
            jsonb_typeof(discussion_analysis_metadata) = 'object'
            AND discussion_analysis_metadata -> 'schema_version' """
        + versions
        + """
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
    """
    )


def _replace_constraints(v2: bool) -> None:
    for name in ("hacksnap_analysis_shape", "hacksnap_analysis_metadata"):
        op.drop_constraint(name, "hacksnap_summaries", type_="check")
    op.create_check_constraint(
        "hacksnap_analysis_shape", "hacksnap_summaries", _shape_constraint(v2)
    )
    op.create_check_constraint(
        "hacksnap_analysis_metadata", "hacksnap_summaries", _metadata_constraint(v2)
    )


def upgrade() -> None:
    _replace_constraints(v2=True)


def downgrade() -> None:
    # Restoring v1 checks requires removing v2 rows first; retain their data on failure.
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM hacksnap_summaries
                       WHERE discussion_analysis_metadata ->> 'schema_version' = '2') THEN
                RAISE EXCEPTION 'Cannot downgrade discussion analysis while v2 rows exist';
            END IF;
        END $$
    """)
    _replace_constraints(v2=False)

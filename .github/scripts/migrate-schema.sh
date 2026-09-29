#!/usr/bin/env bash
# Run from data/ while holding the schema workflow's production concurrency slot.
set -euo pipefail

test -n "$SUPABASE_PASSWORD"
# A queued or manually rerun old checkout must not migrate production.
current_main_sha="$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/main" --jq '.object.sha')"
if [[ ! "$current_main_sha" =~ ^[0-9a-f]{40}$ || "$GITHUB_SHA" != "$current_main_sha" ]]; then
  echo "::error::Schema migration requires the current main revision. Start a new workflow run on main."
  exit 1
fi

uv run alembic current
# Alembic applies only pending upgrades; at head this is a no-op.
uv run alembic upgrade head
uv run alembic current

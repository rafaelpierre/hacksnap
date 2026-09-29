#!/usr/bin/env bash
# Run from hacksnap/ inside the deploy job's concurrency group.
set -euo pipefail

uv sync --locked --no-dev

# Check after setup, immediately before deployment, while holding the queue slot.
# Do not fetch/checkout a newer revision: only this run's SHA passed its tests.
current_main_sha="$(gh api "repos/${GITHUB_REPOSITORY}/git/ref/heads/main" --jq '.object.sha')"
if [[ ! "$current_main_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::Could not determine the current main revision; refusing to deploy."
  exit 1
fi

if [[ "$GITHUB_SHA" != "$current_main_sha" ]]; then
  echo "::notice::Skipping stale Modal deployment: this run is no longer the main tip."
  printf 'Modal deployment skipped: run `%s` is not current main `%s`. Start a new manual run on main if needed.\n' \
    "$GITHUB_SHA" "$current_main_sha" >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

uv run modal deploy modal_app.py

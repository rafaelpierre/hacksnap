#!/usr/bin/env sh
# Start the server from Codex while keeping database credentials out of config.toml.
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)

if [ -f "$project_dir/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$project_dir/.env"
  set +a
fi

exec uv --directory "$script_dir" run hn-threads-mcp

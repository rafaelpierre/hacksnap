# Hacker News trending collector

A scheduled, API-only collector for Hacker News top stories. It uses the official
Hacker News Firebase API (`/v0/topstories.json` and `/v0/item/<id>.json`) and does
not scrape the Hacker News website.

## Setup

```sh
cd data
cp .env.example .env
# Edit .env and replace [YOUR-PASSWORD]. SUPABASE_PASSWORD is sufficient.
uv sync
psql "$DATABASE_URL" -f sql/schema.sql
```

Load the environment file before running the command (for example,
`set -a; source .env; set +a` in zsh/bash):

```sh
uv run hn-trending \
  --title-word ai \
  --title-word engineering \
  --min-comments 20 \
  --min-points 100 \
  --max-comment-depth 3
```

At least one `--title-word` value must occur in a title, without regard to case.
Stories are selected from the first `--limit` (default: 100) IDs returned by the official
top-stories endpoint. Direct comments are depth 1; use depth 0 to persist only
the story payload. `full_raw_text_contents` stores a JSON document containing the
raw official API payload for the story plus every retrieved comment and its depth.

The command upserts by `hn_id`, so it is safe to run on a schedule. It refreshes
the story data and raw contents while retaining the original `date_added` value.
The command always connects through this project's IPv4-capable Supabase pooler
with TLS. Its only required database setting is `SUPABASE_PASSWORD`.

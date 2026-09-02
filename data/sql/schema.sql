-- Run once in the Supabase SQL editor (or with `psql "$DATABASE_URL" -f sql/schema.sql`).
CREATE TABLE IF NOT EXISTS hacker_news_threads (
    hn_id BIGINT PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    full_raw_text_contents TEXT NOT NULL,
    date_published TIMESTAMPTZ NOT NULL,
    date_added TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    author TEXT
);

CREATE INDEX IF NOT EXISTS hacker_news_threads_date_published_idx
    ON hacker_news_threads (date_published DESC);

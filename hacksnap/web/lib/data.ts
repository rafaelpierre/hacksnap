import "server-only";
import path from "node:path";
import { unstable_cache } from "next/cache";
import { Pool, type PoolClient } from "pg";
import { rankHistorySQL, type RankObservation } from "./rank-history";

export type Summary = {
  article_summary: string | null;
  article_key_points: string[];
  discussion_summary: string;
  discussion_points: {title: string; summary: string; comment_ids: number[]}[];
  overall_takeaway: string;
  generated_at: string;
  model: string;
  source_coverage: {
    stored_comments: number;
    included_comments: number;
    comments_truncated: boolean;
    article_status: "fetched" | "unavailable" | "not_applicable";
  };
};

export type Story = {
  hn_id: string;
  title: string;
  url: string;
  points: number;
  comment_count: number;
  rank?: string;
  is_recent?: boolean;
  date_added: Date;
  summary: Summary | null;
};

const globalDB = globalThis as unknown as { hacksnapPool?: Pool };

function pool(): Pool {
  if (!globalDB.hacksnapPool) {
    let connectionString = process.env.HACKSNAP_WEB_DATABASE_URL;
    if (!connectionString && process.env.SUPABASE_PASSWORD) {
      connectionString = `postgresql://postgres.tbihbssiluihmnseuknk:${encodeURIComponent(process.env.SUPABASE_PASSWORD)}@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=verify-full`;
    }
    if (!connectionString) throw new Error("Hacksnap database is not configured");
    // Bundle the public Supabase CA so hosted Node runtimes can verify TLS too.
    // Local preview databases and other providers retain their own SSL settings.
    let databaseURL: URL;
    try { databaseURL = new URL(connectionString); }
    catch { throw new Error("Hacksnap database URL is invalid"); }
    if (databaseURL.hostname.endsWith(".pooler.supabase.com") ||
        databaseURL.hostname.endsWith(".supabase.co")) {
      databaseURL.searchParams.set("sslmode", "verify-full");
      if (!databaseURL.searchParams.has("sslrootcert")) {
        databaseURL.searchParams.set("sslrootcert", path.join(process.cwd(), "certs", "supabase-ca.crt"));
      }
      connectionString = databaseURL.toString();
    }
    globalDB.hacksnapPool = new Pool({
      connectionString, max: 1, connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 90000, allowExitOnIdle: true,
    });
    globalDB.hacksnapPool.on("error", () => console.error("Hacksnap database connection failed"));
  }
  return globalDB.hacksnapPool;
}

async function read<T>(query: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    // Transaction pooling does not preserve session-level settings.
    await client.query("BEGIN READ ONLY; SET LOCAL statement_timeout = '10s'");
    const result = await query(client);
    await client.query("COMMIT");
    return result;
  } catch {
    await client.query("ROLLBACK");
    throw new Error("Hacksnap data is temporarily unavailable");
  } finally {
    client.release();
  }
}

// Explicit public projection: raw comments, ingestion configuration, credentials,
// fingerprints and worker diagnostics never enter a React component.
const fields = `t.hn_id, t.title, t.url, t.points, t.comment_count, t.date_added,
  CASE WHEN s.story_id IS NULL THEN NULL ELSE json_build_object(
    'article_summary', s.article_summary, 'article_key_points', s.article_key_points,
    'discussion_summary', s.discussion_summary, 'discussion_points', s.discussion_points,
    'overall_takeaway', s.overall_takeaway, 'generated_at', s.generated_at,
    'model', s.model, 'source_coverage', s.source_coverage
  ) END AS summary`;

// Cache JSON-safe values: Next's persistent data cache does not preserve Dates.
type CachedLeaderboard = {
  stories: (Omit<Story, "date_added"> & {date_added: string; rank_history: RankObservation[]})[];
  ingestion: string | null;
};

const cachedLeaderboard = unstable_cache(async (): Promise<CachedLeaderboard> => {
  return read(async client => {
    const result = await client.query<{stories: CachedLeaderboard["stories"]; ingestion: Date | null}>(`
      SELECT COALESCE((
        SELECT json_agg(story ORDER BY story.rank) FROM (
          SELECT ${fields}, t.rank, t.is_recent, ${rankHistorySQL} AS rank_history
          FROM hacksnap_current_stories t LEFT JOIN hacksnap_summaries s ON s.story_id = t.hn_id
        ) story
      ), '[]'::json) AS stories, (
        SELECT finished_at FROM hn_ingestion_runs
        WHERE status = 'succeeded' AND filters @> '{"classify_topic": true}'::jsonb
        ORDER BY started_at DESC, run_id DESC LIMIT 1
      ) AS ingestion`);
    const {stories, ingestion} = result.rows[0];
    return {stories, ingestion: ingestion?.toISOString() ?? null};
  });
}, ["hacksnap-leaderboard-v4"], {revalidate: 600});

export async function getLeaderboard(): Promise<{stories: (Story & {rank_history: RankObservation[]})[]; ingestion: Date | null}> {
  const {stories, ingestion} = await cachedLeaderboard();
  return {
    stories: stories.map(story => ({...story, date_added: new Date(story.date_added)})),
    ingestion: ingestion ? new Date(ingestion) : null,
  };
}

export async function getPublicStoryIds(): Promise<string[]> {
  return read(async client => {
    // Match getStory's public collection and supported route IDs, including
    // archived stories and stories whose summaries are still pending.
    const result = await client.query<{hn_id: string}>(`
      SELECT hn_id FROM hacker_news_threads
      WHERE hn_id BETWEEN 1 AND 999999999999999
      ORDER BY hn_id`);
    return result.rows.map(story => story.hn_id);
  });
}

export async function getStory(id: string): Promise<Story | null> {
  // Bound the route before handing a bigint to PostgreSQL.
  if (!/^[1-9][0-9]{0,14}$/.test(id)) return null;
  return read(async client => {
    const result = await client.query<Story>(`SELECT ${fields}
      FROM hacker_news_threads t LEFT JOIN hacksnap_summaries s ON s.story_id = t.hn_id
      WHERE t.hn_id = $1`, [id]);
    return result.rows[0] ?? null;
  });
}

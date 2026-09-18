import "server-only";
import { Pool, type PoolClient } from "pg";

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
    globalDB.hacksnapPool = new Pool({
      connectionString, max: 3, connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 20000, statement_timeout: 10000,
      options: "-c default_transaction_read_only=on",
    });
    globalDB.hacksnapPool.on("error", () => console.error("Hacksnap database connection failed"));
  }
  return globalDB.hacksnapPool;
}

async function read<T>(query: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN READ ONLY");
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

export async function getLeaderboard(): Promise<{stories: Story[]; ingestion: Date | null}> {
  return read(async client => {
    const result = await client.query<Story>(`SELECT ${fields}, t.rank, t.is_recent
      FROM hacksnap_current_stories t LEFT JOIN hacksnap_summaries s ON s.story_id = t.hn_id
      ORDER BY t.rank`);
    const runs = await client.query<{finished_at: Date}>(`SELECT finished_at FROM hn_ingestion_runs
      WHERE status = 'succeeded' AND filters @> '{"classify_topic": true}'::jsonb
      ORDER BY started_at DESC, run_id DESC LIMIT 1`);
    return {stories: result.rows, ingestion: runs.rows[0]?.finished_at ?? null};
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

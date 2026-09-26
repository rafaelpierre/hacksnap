import "server-only";
import { ARCHIVE_PAGE_SIZE, archiveMonthsSQL, archiveQuery } from "./archive";
import path from "node:path";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { Pool, type PoolClient } from "pg";
import { rankHistorySQL, type RankObservation } from "./rank-history";
import { storyMetricsSQL, type RankingMetrics } from "./story-metrics";
import { CATEGORY_PAGE_SIZE, categoryCountsSQL, categoryQuery, relatedStoriesQuery, type CategoryId, type CategoryCounts } from "./categories";

export type Summary = {
  article_summary: string | null;
  article_key_points: string[];
  discussion_summary: string;
  discussion_points: {title: string; summary: string; comment_ids: number[]}[];
  sentiment: -1 | 0 | 1 | null;
  overall_takeaway: string;
  generated_at: string;
  model: string;
  source_coverage: {
    stored_comments: number;
    included_comments: number;
    comments_truncated: boolean;
    article_status: "fetched" | "unavailable" | "not_applicable";
    sentiment?: { included_comments: number };
  };
};

export type Story = {
  hn_id: string;
  title: string;
  category: CategoryId | null;
  url: string;
  points: number;
  comment_count: number;
  rank?: string;
  is_recent?: boolean;
  date_added: Date;
  summary: Summary | null;
  rank_history?: RankObservation[];
  observed_at?: string;
  ranking_metrics?: RankingMetrics;
};

const globalDB = globalThis as unknown as { hacksnapPool?: Pool };

function pool(): Pool {
  if (!globalDB.hacksnapPool) {
    let connectionString = process.env.HACKSNAP_WEB_DATABASE_URL;
    if (!connectionString) throw new Error("HACKSNAP_WEB_DATABASE_URL is required");
    // Bundle the public Supabase CA so hosted Node runtimes can verify TLS too.
    // Local preview databases and other providers retain their own SSL settings.
    let databaseURL: URL;
    try { databaseURL = new URL(connectionString); }
    catch { throw new Error("Hacksnap database URL is invalid"); }
    if (databaseURL.hostname.endsWith(".pooler.supabase.com") ||
        databaseURL.hostname.endsWith(".supabase.co")) {
      if (decodeURIComponent(databaseURL.username).split(".")[0] !== "hacksnap_reader") {
        throw new Error("Supabase web connections require the hacksnap_reader role");
      }
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
const fields = `t.hn_id, t.title, t.url, t.points, t.comment_count, t.date_added, t.category,
  CASE WHEN s.story_id IS NULL THEN NULL ELSE json_build_object(
    'article_summary', s.article_summary, 'article_key_points', s.article_key_points,
    'discussion_summary', s.discussion_summary, 'discussion_points', s.discussion_points,
    'sentiment', s.sentiment, 'overall_takeaway', s.overall_takeaway, 'generated_at', s.generated_at,
    'model', s.model, 'source_coverage', s.source_coverage
  ) END AS summary`;

// Cache JSON-safe values: Next's persistent data cache does not preserve Dates.
type CachedLeaderboard = {
  stories: (Omit<Story, "date_added"> & {date_added: string; rank_history: RankObservation[]})[];
  ingestion: string | null;
  observed_at: string;
};

// Invalidate cached point-velocity payloads when switching to rank history.
const cachedLeaderboard = unstable_cache(async (): Promise<CachedLeaderboard> => {
  return read(async client => {
    const result = await client.query<{stories: CachedLeaderboard["stories"]; ingestion: Date | null; ranked_at: Date}>(`
      SELECT COALESCE((
        SELECT json_agg(story ORDER BY story.rank) FROM (
          SELECT ${fields}, t.rank, t.is_recent, ${rankHistorySQL} AS rank_history
          FROM hacksnap_current_stories t LEFT JOIN hacksnap_summaries s ON s.story_id = t.hn_id
        ) story
      ), '[]'::json) AS stories, (
        SELECT finished_at FROM hn_ingestion_runs
        WHERE status = 'succeeded' AND filters @> '{"classify_topic": true}'::jsonb
        ORDER BY started_at DESC, run_id DESC LIMIT 1
      ) AS ingestion, CURRENT_TIMESTAMP AS ranked_at`);
    const {stories, ingestion, ranked_at} = result.rows[0];
    return {
      stories,
      observed_at: ranked_at.toISOString(),
      ingestion: ingestion?.toISOString() ?? null,
    };
  });
}, ["hacksnap-leaderboard-v10-categories"], {revalidate: 1800});

export async function getLeaderboard(): Promise<{stories: (Story & {rank_history: RankObservation[]})[]; ingestion: Date | null; observed_at: string}> {
  const {stories, ingestion, observed_at} = await cachedLeaderboard();
  return {
    stories: stories.map(story => ({...story, date_added: new Date(story.date_added)})),
    ingestion: ingestion ? new Date(ingestion) : null,
    observed_at,
  };
}

export async function getSitemapStories(): Promise<{hn_id: string; modified_at: Date}[]> {
  return read(async client => {
    // Include current and archived stories only once a summary is available,
    // matching the indexing policy in storyPreviewMetadata.
    const result = await client.query<{hn_id: string; modified_at: Date}>(`
      SELECT t.hn_id, GREATEST(t.date_added, s.updated_at, (
        SELECT observed_at FROM hn_thread_snapshots
        WHERE hn_id = t.hn_id ORDER BY observed_at DESC LIMIT 1
      ), (
        SELECT observed_at FROM hacksnap_rank_history
        WHERE hn_id = t.hn_id AND observed_at <= CURRENT_TIMESTAMP
        ORDER BY observed_at DESC LIMIT 1
      )) AS modified_at
      FROM hacker_news_threads t
      INNER JOIN hacksnap_summaries s ON s.story_id = t.hn_id
      WHERE t.hn_id BETWEEN 1 AND 999999999999999
      ORDER BY t.hn_id`);
    return result.rows;
  });
}

export async function getFeedStories(): Promise<Story[]> {
  return read(async client => {
    const result = await client.query<Story>(`SELECT ${fields}, r.rank, ${rankHistorySQL} AS rank_history,
      to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at
      FROM hacker_news_threads t LEFT JOIN hacksnap_summaries s ON s.story_id = t.hn_id
      LEFT JOIN hacksnap_ranked_stories r ON r.hn_id = t.hn_id
      WHERE t.hn_id BETWEEN 1 AND 999999999999999
      ORDER BY t.date_added DESC, t.hn_id DESC LIMIT 50`);
    return result.rows;
  });
}

// Share the read between page metadata and rendering within the same request.
export const getStory = cache(async (id: string): Promise<Story | null> => {
  // Bound the route before handing a bigint to PostgreSQL.
  if (!/^[1-9][0-9]{0,14}$/.test(id)) return null;
  return read(async client => {
    const result = await client.query<Story>(`SELECT ${fields}, r.rank, ${rankHistorySQL} AS rank_history,
      ${storyMetricsSQL} AS ranking_metrics,
      to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at
      FROM hacker_news_threads t LEFT JOIN hacksnap_summaries s ON s.story_id = t.hn_id
      LEFT JOIN hacksnap_ranked_stories r ON r.hn_id = t.hn_id
      WHERE t.hn_id = $1`, [id]);
    return result.rows[0] ?? null;
  });
});

export const getArchiveMonths = cache(async (): Promise<{month: string; count: number}[]> =>
  read(async client => (await client.query<{month: string; count: number}>(archiveMonthsSQL)).rows));

export const getCategoryCounts = cache(async (): Promise<CategoryCounts> => read(async client => {
  const {rows} = await client.query<{category: CategoryId; count: number}>(categoryCountsSQL);
  return Object.fromEntries(rows.map(row => [row.category, row.count]));
}));

export const getCategoryStories = cache(async (category: CategoryId, page: number) => read(async client => {
  const {rows} = await client.query<Story>(categoryQuery(fields, category, page));
  return {stories: rows.slice(0, CATEGORY_PAGE_SIZE), hasNext: rows.length > CATEGORY_PAGE_SIZE};
}));

export type RelatedStory = Pick<Story, "hn_id" | "title" | "date_added"> & {takeaway: string};

export const getRelatedStories = cache(async (category: CategoryId, currentStoryId: string): Promise<RelatedStory[]> =>
  read(async client => (await client.query<RelatedStory>(relatedStoriesQuery(category, currentStoryId))).rows));

export const getArchiveStories = cache(async (month: string | null, page: number) =>
  read(async client => {
    const result = await client.query<Story>(archiveQuery(fields, month, page));
    return {stories: result.rows.slice(0, ARCHIVE_PAGE_SIZE), hasNext: result.rows.length > ARCHIVE_PAGE_SIZE};
  }));

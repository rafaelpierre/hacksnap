import "server-only";
import { DataUnavailableError } from "./data-availability";
import { boundedCache } from "./bounded-cache";
import { publicStorySQL, validStoryId, type PublicStory } from "./public-story";
import {
  ARCHIVE_PAGE_SIZE,
  MAX_BROWSE_PAGE,
  assertBrowsePage,
  archiveMonthsSQL,
  archiveQuery,
} from "./archive";
import path from "node:path";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { Pool, type PoolClient } from "pg";
import { rankHistorySQL, type RankObservation } from "./rank-history";
import { storyMetricsSQL, type RankingMetrics } from "./story-metrics";
import {
  CATEGORY_PAGE_SIZE,
  categoryCountsSQL,
  categoryQuery,
  relatedStoriesQuery,
  type CategoryId,
  type CategoryCounts,
} from "./categories";

import type { DiscussionFields } from "./discussion-analysis";
import {
  feedFields,
  storyFields,
  legacyFeedFields,
  legacyStoryFields,
  discussionColumnsSQL,
} from "./story-projection";
export type {
  DiscussionAnalysis,
  DiscussionAnalysisPreview,
  DiscussionAnalysisCoverage,
} from "./discussion-analysis";

export type Summary = DiscussionFields & {
  article_summary: string | null;
  article_key_points: string[];
  discussion_summary: string;
  discussion_points: { title: string; summary: string; comment_ids: number[] }[];
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
    try {
      databaseURL = new URL(connectionString);
    } catch {
      throw new Error("Hacksnap database URL is invalid");
    }
    if (
      databaseURL.hostname.endsWith(".pooler.supabase.com") ||
      databaseURL.hostname.endsWith(".supabase.co")
    ) {
      if (decodeURIComponent(databaseURL.username).split(".")[0] !== "hacksnap_reader") {
        throw new Error("Supabase web connections require the hacksnap_reader role");
      }
      databaseURL.searchParams.set("sslmode", "verify-full");
      if (!databaseURL.searchParams.has("sslrootcert")) {
        databaseURL.searchParams.set(
          "sslrootcert",
          path.join(process.cwd(), "certs", "supabase-ca.crt"),
        );
      }
      connectionString = databaseURL.toString();
    }
    globalDB.hacksnapPool = new Pool({
      connectionString,
      max: 1,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 90000,
      allowExitOnIdle: true,
    });
    globalDB.hacksnapPool.on("error", () => console.error("Hacksnap database connection failed"));
  }
  return globalDB.hacksnapPool;
}

async function read<T>(query: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient | undefined;
  try {
    client = await pool().connect();
    // Transaction pooling does not preserve session-level settings.
    await client.query("BEGIN READ ONLY; SET LOCAL statement_timeout = '10s'");
    const result = await query(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    // SQLSTATE is useful operationally; messages can contain private query data.
    const code = (error as { code?: unknown } | null)?.code;
    console.error("Hacksnap database read failed", {
      code: typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : "unknown",
    });
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Evict a broken connection without replacing the sanitized read error.
        client.release(true);
        client = undefined;
      }
    }
    throw new DataUnavailableError();
  } finally {
    client?.release();
  }
}

async function hasDiscussionColumns(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ available: boolean }>(discussionColumnsSQL);
  const available = rows[0].available;
  if (!available) {
    console.warn(
      "Hacksnap discussion analysis unavailable: apply migration 0012 and its reader grants",
    );
  }
  return available;
}

// Check on each cache miss so applying the migration needs no process restart.
function readStories<T>(
  kind: "feed" | "story",
  query: (client: PoolClient, fields: string) => Promise<T>,
): Promise<T> {
  return read(async (client) => {
    const available = await hasDiscussionColumns(client);
    const fields =
      kind === "feed"
        ? available
          ? feedFields
          : legacyFeedFields
        : available
          ? storyFields
          : legacyStoryFields;
    return query(client, fields);
  });
}

// Cache JSON-safe values: Next's persistent data cache does not preserve Dates.
type CachedLeaderboard = {
  stories: (Omit<Story, "date_added"> & { date_added: string; rank_history: RankObservation[] })[];
  ingestion: string | null;
  observed_at: string;
};

// Invalidate cached selections made before preview filtering and backfill.
const cachedLeaderboard = unstable_cache(
  async (): Promise<CachedLeaderboard> => {
    return readStories("feed", async (client, fields) => {
      const result = await client.query<{
        stories: CachedLeaderboard["stories"];
        ingestion: Date | null;
        ranked_at: Date;
      }>(`
      SELECT COALESCE((
        SELECT json_agg(story ORDER BY story.rank) FROM (
          SELECT ${fields}, t.rank, t.is_recent, ${rankHistorySQL} AS rank_history
          FROM hacksnap_ranked_stories t INNER JOIN hacksnap_summaries s ON s.story_id = t.hn_id
          WHERE s.overall_takeaway ~ '[^[:space:]]'
          ORDER BY t.rank
          LIMIT 10
        ) story
      ), '[]'::json) AS stories, (
        SELECT finished_at FROM hn_ingestion_runs
        WHERE status = 'succeeded' AND filters @> '{"classify_topic": true}'::jsonb
        ORDER BY started_at DESC, run_id DESC LIMIT 1
      ) AS ingestion, CURRENT_TIMESTAMP AS ranked_at`);
      const { stories, ingestion, ranked_at } = result.rows[0];
      return {
        stories,
        observed_at: ranked_at.toISOString(),
        ingestion: ingestion?.toISOString() ?? null,
      };
    });
  },
  ["hacksnap-leaderboard-v12-ready-top-ten"],
  { revalidate: 1800 },
);

export async function getLeaderboard(): Promise<{
  stories: (Story & { rank_history: RankObservation[] })[];
  ingestion: Date | null;
  observed_at: string;
}> {
  const { stories, ingestion, observed_at } = await cachedLeaderboard();
  return {
    stories: stories.map((story) => ({ ...story, date_added: new Date(story.date_added) })),
    ingestion: ingestion ? new Date(ingestion) : null,
    observed_at,
  };
}

export async function getSitemapStories(): Promise<{ hn_id: string; modified_at: Date }[]> {
  return read(async (client) => {
    // Include current and archived stories only once a summary is available,
    // matching the indexing policy in storyPreviewMetadata.
    const result = await client.query<{ hn_id: string; modified_at: Date }>(`
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

const cachedFeedStories = boundedCache(
  async (): Promise<Story[]> => {
    return readStories("feed", async (client, fields) => {
      const result =
        await client.query<Story>(`SELECT ${fields}, r.rank, ${rankHistorySQL} AS rank_history,
      to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at
      FROM hacker_news_threads t LEFT JOIN hacksnap_summaries s ON s.story_id = t.hn_id
      LEFT JOIN hacksnap_ranked_stories r ON r.hn_id = t.hn_id
      WHERE t.hn_id BETWEEN 1 AND 999999999999999
      ORDER BY t.date_added DESC, t.hn_id DESC LIMIT 50`);
      return result.rows;
    });
  },
  { ttl: () => 300_000, maxEntries: 1, maxPending: 1 },
);

export function getFeedStories(): Promise<Story[]> {
  return cachedFeedStories("feed");
}

const cachedPublicStory = boundedCache(
  async (id: string): Promise<PublicStory | null> =>
    read(async (client) => {
      const sql = publicStorySQL(await hasDiscussionColumns(client));
      return (await client.query<PublicStory>(sql, [id])).rows[0] ?? null;
    }),
  { ttl: (story) => (story ? 300_000 : 60_000), maxEntries: 512, maxPending: 8 },
);

export async function getPublicStory(id: string): Promise<PublicStory | null> {
  if (!validStoryId(id)) return null;
  return cachedPublicStory(id);
}

// Cache expensive renderer reads across requests, including negotiated Markdown.
const cachedStory = boundedCache(
  async (id: string): Promise<Story | null> => {
    return readStories("story", async (client, fields) => {
      const result = await client.query<Story>(
        `SELECT ${fields}, r.rank, ${rankHistorySQL} AS rank_history,
      ${storyMetricsSQL} AS ranking_metrics,
      to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at
      FROM hacker_news_threads t LEFT JOIN hacksnap_summaries s ON s.story_id = t.hn_id
      LEFT JOIN hacksnap_ranked_stories r ON r.hn_id = t.hn_id
      WHERE t.hn_id = $1`,
        [id],
      );
      return result.rows[0] ?? null;
    });
  },
  { ttl: (story) => (story ? 1_800_000 : 60_000), maxEntries: 128, maxPending: 4 },
);

// Share the result between page metadata and rendering within the same request.
export const getStory = cache(async (id: string): Promise<Story | null> => {
  if (!validStoryId(id)) return null;
  try {
    return await cachedStory(id);
  } catch {
    throw new DataUnavailableError();
  }
});

export const getArchiveMonths = cache(async (): Promise<{ month: string; count: number }[]> =>
  read(
    async (client) => (await client.query<{ month: string; count: number }>(archiveMonthsSQL)).rows,
  ),
);

export const getCategoryCounts = cache(async (): Promise<CategoryCounts> =>
  read(async (client) => {
    const { rows } = await client.query<{ category: CategoryId; count: number }>(categoryCountsSQL);
    return Object.fromEntries(rows.map((row) => [row.category, row.count]));
  }),
);

export const getCategoryStories = cache(async (category: CategoryId, page: number) => {
  assertBrowsePage(page);
  return readStories("feed", async (client, fields) => {
    const { rows } = await client.query<Story>(categoryQuery(fields, category, page));
    return {
      stories: rows.slice(0, CATEGORY_PAGE_SIZE),
      hasNext: page < MAX_BROWSE_PAGE && rows.length > CATEGORY_PAGE_SIZE,
    };
  });
});

export type RelatedStory = Pick<Story, "hn_id" | "title" | "url" | "date_added"> & {
  takeaway: string;
};

export const getRelatedStories = cache(
  async (category: CategoryId, currentStoryId: string): Promise<RelatedStory[]> =>
    read(
      async (client) =>
        (await client.query<RelatedStory>(relatedStoriesQuery(category, currentStoryId))).rows,
    ),
);

export const getArchiveStories = cache(async (month: string | null, page: number) => {
  assertBrowsePage(page);
  return readStories("feed", async (client, fields) => {
    const result = await client.query<Story>(archiveQuery(fields, month, page));
    return {
      stories: result.rows.slice(0, ARCHIVE_PAGE_SIZE),
      hasNext: page < MAX_BROWSE_PAGE && result.rows.length > ARCHIVE_PAGE_SIZE,
    };
  });
});

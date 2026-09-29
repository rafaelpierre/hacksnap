import "server-only";
import { storySlugColumnSQL, storySlugProjection } from "./story-slug-projection";
import { DataUnavailableError } from "./data-availability";
import { boundedCache } from "./bounded-cache";
import {
  READY_STORY_CURSOR_TTL_MS,
  READY_STORY_PAGE_SIZE,
  ReadyStoryPageError,
  assertReadyStoryPage,
  assertReadyStoryPageSize,
  createReadyStoryCursor,
  parseReadyStoryCursor,
  type ReadyStorySnapshotItem,
} from "./ready-story-pagination";
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
  feedFieldsWithoutImages,
  storyFields,
  storyFieldsWithoutImages,
  legacyFeedFields,
  legacyFeedFieldsWithoutImages,
  legacyStoryFields,
  legacyStoryFieldsWithoutImages,
  discussionColumnsSQL,
  imageColumnsSQL,
} from "./story-projection";
import type { StoryImageFields } from "./story-image";
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

export type Story = StoryImageFields & {
  hn_id: string;
  title: string;
  story_slug?: string | null;
  category: CategoryId | null;
  url: string;
  points: number;
  comment_count: number;
  rank?: string;
  is_recent?: boolean;
  date_added: Date;
  image_url?: string | null;
  image_status?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  image_mime_type?: string | null;
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
    await client.query(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout = '10s'",
    );
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
  if (process.env.HACKSNAP_DISCUSSION_RENDERING === "false") return false;
  const { rows } = await client.query<{ available: boolean }>(discussionColumnsSQL);
  const available = rows[0].available;
  if (!available) {
    console.warn(
      "Hacksnap discussion analysis unavailable: apply migration 0012 and its reader grants",
    );
  }
  return available;
}

async function hasImageColumns(client: PoolClient): Promise<boolean> {
  const { rows } = await client.query<{ available: boolean }>(imageColumnsSQL);
  const available = rows[0].available;
  if (!available) {
    console.warn("Hacksnap stored images unavailable: apply migration 0015 and its reader grants");
  }
  return available;
}

async function storySlugField(client: PoolClient): Promise<string> {
  const { rows } = await client.query<{ available: boolean }>(storySlugColumnSQL);
  return storySlugProjection(rows[0]?.available === true);
}

// Check on each cache miss so applying the migration needs no process restart.
function readStories<T>(
  kind: "feed" | "story",
  query: (client: PoolClient, fields: string) => Promise<T>,
): Promise<T> {
  return read(async (client) => {
    const [discussionAvailable, imagesAvailable] = await Promise.all([
      hasDiscussionColumns(client),
      hasImageColumns(client),
    ]);
    const fields =
      kind === "feed"
        ? discussionAvailable
          ? imagesAvailable
            ? feedFields
            : feedFieldsWithoutImages
          : imagesAvailable
            ? legacyFeedFields
            : legacyFeedFieldsWithoutImages
        : discussionAvailable
          ? imagesAvailable
            ? storyFields
            : storyFieldsWithoutImages
          : imagesAvailable
            ? legacyStoryFields
            : legacyStoryFieldsWithoutImages;
    return query(client, `${fields}, ${await storySlugField(client)}`);
  });
}

// SQL JSON aggregation returns story dates as strings.
type CachedLeaderboard = {
  stories: (Omit<Story, "date_added"> & { date_added: string; rank_history: RankObservation[] })[];
  ingestion: string | null;
  observed_at: string;
};

export async function getLeaderboard(): Promise<{
  stories: (Story & { rank_history: RankObservation[] })[];
  ingestion: Date | null;
  observed_at: string;
}> {
  const { stories, ingestion, observed_at } = await loadReadyStorySelection();
  return {
    stories: stories.map((story) => ({ ...story, date_added: new Date(story.date_added) })),
    ingestion: ingestion ? new Date(ingestion) : null,
    observed_at,
  };
}

type CachedReadyStorySelection = CachedLeaderboard & {
  items: ReadyStorySnapshotItem[];
  selection_limited: boolean;
};

// All homepage formats share this hard-expiring selection and its first ten cards.
// One SQL statement captures the cards, pagination membership and timestamps together.
// The selection itself is capped to keep its portable cursor under normal URL limits.
// The extra row distinguishes that cap from a genuine end of the ranked pool.
const cachedReadyStorySelection = boundedCache(
  async (): Promise<CachedReadyStorySelection> => {
    return readStories("feed", async (client, fields) => {
      const result = await client.query<{
        stories: CachedLeaderboard["stories"];
        items: { hn_id: string | number; rank: string | number; is_recent: boolean }[];
        ingestion: Date | null;
        ranked_at: Date;
      }>(`
      WITH ready AS MATERIALIZED (
        SELECT r.hn_id, r.rank, r.is_recent
        FROM hacksnap_ranked_stories r
        INNER JOIN hacker_news_threads t ON t.hn_id = r.hn_id
        INNER JOIN hacksnap_summaries s ON s.story_id = t.hn_id
        WHERE s.overall_takeaway ~ '[^[:space:]]'
        ORDER BY r.rank
        LIMIT 401
      )
      SELECT COALESCE((
        SELECT json_agg(item ORDER BY item.rank) FROM ready item
      ), '[]'::json) AS items, COALESCE((
        SELECT json_agg(story ORDER BY story.rank) FROM (
          SELECT ${fields}, r.rank, r.is_recent, ${rankHistorySQL} AS rank_history
          FROM (SELECT * FROM ready ORDER BY rank LIMIT 10) r
          INNER JOIN hacker_news_threads t ON t.hn_id = r.hn_id
          INNER JOIN hacksnap_summaries s ON s.story_id = t.hn_id
        ) story
      ), '[]'::json) AS stories, (
        SELECT finished_at FROM hn_ingestion_runs
        WHERE status = 'succeeded' AND filters @> '{"classify_topic": true}'::jsonb
        ORDER BY started_at DESC, run_id DESC LIMIT 1
      ) AS ingestion, CURRENT_TIMESTAMP AS ranked_at`);
      const { stories, items, ingestion, ranked_at } = result.rows[0];
      let selected = items.slice(0, 400).map((item) => ({
        hn_id: String(item.hn_id),
        rank: String(item.rank),
        is_recent: item.is_recent === true,
      }));
      let selection_limited = items.length > selected.length;
      // A pathological rank/ID sequence can be less compressible than normal. Trim
      // only until the next-page cursor fits, and expose that fact to callers.
      while (selected.length > READY_STORY_PAGE_SIZE) {
        try {
          createReadyStoryCursor({
            items: selected,
            offset: READY_STORY_PAGE_SIZE,
            pageSize: READY_STORY_PAGE_SIZE,
            observedAt: ranked_at.toISOString(),
            ingestion: ingestion?.toISOString() ?? null,
            selectionLimited: selection_limited,
            expiresAt: new Date(Date.now() + READY_STORY_CURSOR_TTL_MS),
          });
          break;
        } catch (error) {
          if (!(error instanceof ReadyStoryPageError)) throw error;
          selected = selected.slice(0, -1);
          selection_limited = true;
        }
      }
      return {
        // json_agg embeds bigint IDs/ranks as JSON numbers; keep the same string
        // representation used by ordinary pg rows and continuation hydration.
        stories: stories.map((story) => ({
          ...story,
          hn_id: String(story.hn_id),
          rank: story.rank === undefined ? undefined : String(story.rank),
        })),
        items: selected,
        selection_limited,
        observed_at: ranked_at.toISOString(),
        ingestion: ingestion?.toISOString() ?? null,
      };
    });
  },
  { ttl: () => 60_000, maxEntries: 1, maxPending: 1 },
);

type ReadySnapshotRow = Story & { snapshot_ready: boolean; rank_history: RankObservation[] };

async function getReadySnapshotStories(
  items: ReadyStorySnapshotItem[],
): Promise<(Story & { rank_history: RankObservation[] })[]> {
  const result = await readStories("feed", async (client, fields) => {
    return client.query<ReadySnapshotRow>(
      `SELECT ${fields}, selected.rank::text AS rank, selected.is_recent,
        ${rankHistorySQL} AS rank_history,
        (r.hn_id IS NOT NULL AND s.overall_takeaway ~ '[^[:space:]]') AS snapshot_ready
      FROM unnest($1::bigint[], $2::bigint[], $3::boolean[]) WITH ORDINALITY
        AS selected(hn_id, rank, is_recent, position)
      INNER JOIN hacker_news_threads t ON t.hn_id = selected.hn_id
      LEFT JOIN hacksnap_summaries s ON s.story_id = t.hn_id
      LEFT JOIN hacksnap_ranked_stories r ON r.hn_id = t.hn_id
      ORDER BY selected.position`,
      [
        items.map((item) => item.hn_id),
        items.map((item) => item.rank),
        items.map((item) => item.is_recent),
      ],
    );
  });
  if (result.rows.length !== items.length || result.rows.some((story) => !story.snapshot_ready))
    throw new ReadyStoryPageError("snapshot_invalidated");
  return result.rows.map(({ snapshot_ready: _snapshotReady, ...story }) => story);
}

// Cursor pages are public but unbounded in cardinality. Keep only a small LRU
// and cap concurrent misses so random continuation values cannot exhaust the pool.
const cachedReadySnapshotStories = boundedCache(
  async (key: string) => {
    const separator = key.indexOf("|");
    const records = key.slice(separator + 1).split(";");
    return getReadySnapshotStories(
      records.map((record) => {
        const [hn_id, rank, recent] = record.split(",");
        return { hn_id, rank, is_recent: recent === "1" };
      }),
    );
  },
  { ttl: () => 60_000, maxEntries: 64, maxPending: 8 },
);

function cachedReadySnapshotPage(observedAt: string, items: ReadyStorySnapshotItem[]) {
  return cachedReadySnapshotStories(
    `${observedAt}|${items.map((item) => `${item.hn_id},${item.rank},${item.is_recent ? 1 : 0}`).join(";")}`,
  ).catch((error) => {
    if (error instanceof ReadyStoryPageError || error instanceof DataUnavailableError) throw error;
    throw new DataUnavailableError();
  });
}

function loadReadyStorySelection() {
  return cachedReadyStorySelection("ready-stories").catch((error) => {
    if (error instanceof ReadyStoryPageError || error instanceof DataUnavailableError) throw error;
    throw new DataUnavailableError();
  });
}

export type ReadyStoryPage = {
  stories: (Story & { rank_history: RankObservation[] })[];
  ingestion: Date | null;
  observed_at: string;
  pagination: {
    cursor: string | null;
    hasMore: boolean;
    page: number;
    previousCursor: string | null;
    expiresAt: string;
    selectionLimited: boolean;
  };
};

export async function getReadyStoryPage({
  cursor,
  page,
  pageSize,
}: {
  cursor?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<ReadyStoryPage> {
  if (cursor !== undefined) {
    const snapshot = parseReadyStoryCursor(cursor);
    const size = snapshot.pageSize;
    if (pageSize !== undefined && assertReadyStoryPageSize(pageSize) !== size)
      throw new ReadyStoryPageError("invalid_page_size");
    const cursorPage = Math.floor(snapshot.offset / size) + 1;
    if (page !== undefined && assertReadyStoryPage(page) !== cursorPage)
      throw new ReadyStoryPageError("invalid_page");
    const items = snapshot.items.slice(snapshot.offset, snapshot.offset + size);
    const nextOffset = snapshot.offset + items.length;
    const hasMore = nextOffset < snapshot.items.length;
    return {
      stories: await cachedReadySnapshotPage(snapshot.observedAt, items),
      ingestion: snapshot.ingestion ? new Date(snapshot.ingestion) : null,
      observed_at: snapshot.observedAt,
      pagination: {
        cursor: hasMore
          ? createReadyStoryCursor({
              ...snapshot,
              offset: nextOffset,
              expiresAt: new Date(snapshot.expiresAt),
            })
          : null,
        hasMore,
        page: cursorPage,
        previousCursor:
          cursorPage > 1
            ? createReadyStoryCursor({
                ...snapshot,
                offset: Math.max(0, snapshot.offset - size),
                expiresAt: new Date(snapshot.expiresAt),
              })
            : null,
        expiresAt: snapshot.expiresAt,
        selectionLimited: snapshot.selectionLimited,
      },
    };
  }

  const size = assertReadyStoryPageSize(pageSize);
  const requestedPage = assertReadyStoryPage(page);
  const selection = await loadReadyStorySelection();
  const offset = (requestedPage - 1) * size;
  if (offset >= selection.items.length && (selection.items.length !== 0 || requestedPage > 1))
    throw new ReadyStoryPageError("invalid_page");
  const items = selection.items;
  const pageItems = items.slice(offset, offset + size);
  const stories =
    offset + pageItems.length <= selection.stories.length
      ? selection.stories
          .slice(offset, offset + pageItems.length)
          .map((story) => ({ ...story, date_added: new Date(story.date_added) }))
      : await cachedReadySnapshotPage(selection.observed_at, pageItems);
  const nextOffset = offset + stories.length;
  const hasMore = nextOffset < items.length;
  const expiresAt = new Date(Date.now() + READY_STORY_CURSOR_TTL_MS);
  return {
    stories,
    ingestion: selection.ingestion ? new Date(selection.ingestion) : null,
    observed_at: selection.observed_at,
    pagination: {
      cursor: hasMore
        ? createReadyStoryCursor({
            items,
            offset: nextOffset,
            pageSize: size,
            observedAt: selection.observed_at,
            ingestion: selection.ingestion,
            selectionLimited: selection.selection_limited,
            expiresAt,
          })
        : null,
      hasMore,
      page: requestedPage,
      previousCursor:
        requestedPage > 1
          ? createReadyStoryCursor({
              items,
              offset: Math.max(0, offset - size),
              pageSize: size,
              observedAt: selection.observed_at,
              ingestion: selection.ingestion,
              selectionLimited: selection.selection_limited,
              expiresAt,
            })
          : null,
      expiresAt: expiresAt.toISOString(),
      selectionLimited: selection.selection_limited,
    },
  };
}

export async function getSitemapStories(): Promise<
  { hn_id: string; story_slug: string | null; modified_at: Date }[]
> {
  return read(async (client) => {
    // Include current and archived stories only once a summary is available,
    // matching the indexing policy in storyPreviewMetadata.
    const result = await client.query<{
      hn_id: string;
      story_slug: string | null;
      modified_at: Date;
    }>(`
      SELECT t.hn_id, ${await storySlugField(client)}, GREATEST(t.date_added, s.updated_at, (
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
      const sql = publicStorySQL(
        await hasDiscussionColumns(client),
        (await client.query<{ available: boolean }>(imageColumnsSQL)).rows[0]?.available === true,
      );
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

export type RelatedStory = Pick<Story, "hn_id" | "title" | "url" | "date_added" | "story_slug"> & {
  takeaway: string;
};

export const getRelatedStories = cache(
  async (category: CategoryId, currentStoryId: string): Promise<RelatedStory[]> =>
    read(
      async (client) =>
        (
          await client.query<RelatedStory>(
            relatedStoriesQuery(category, currentStoryId, await storySlugField(client)),
          )
        ).rows,
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

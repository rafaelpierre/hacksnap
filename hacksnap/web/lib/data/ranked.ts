import "server-only";
import { cachePolicy } from "./cache-policy";
import { readStories } from "./capabilities";
import { boundedCache } from "../bounded-cache";
import { DataUnavailableError } from "../data-availability";
import { readySummarySQL } from "../ready-stories";
import type { CardStory } from "../story-domain";
import { cardRankHistoryAtSQL, cardRankHistorySQL, type RankObservation } from "../rank-history";
import {
  READY_STORY_CURSOR_TTL_MS,
  READY_STORY_PAGE_SIZE,
  ReadyStoryPageError,
  assertReadyStoryPage,
  assertReadyStoryPageSize,
  createReadyStoryCursor,
  parseReadyStoryCursor,
  type ReadyStorySnapshotItem,
} from "../ready-story-pagination";

// SQL JSON aggregation returns story dates as strings.
type CachedLeaderboard = {
  stories: (Omit<CardStory, "date_added"> & {
    date_added: string;
    rank_history: RankObservation[];
  })[];
  ingestion: string | null;
  observed_at: string;
};

export async function getLeaderboard(): Promise<{
  stories: (CardStory & { rank_history: RankObservation[] })[];
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
async function queryReadyStorySelection(): Promise<CachedReadyStorySelection> {
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
        WHERE ${readySummarySQL}
        ORDER BY r.rank
        LIMIT 401
      )
      SELECT COALESCE((
        SELECT json_agg(item ORDER BY item.rank) FROM ready item
      ), '[]'::json) AS items, COALESCE((
        SELECT json_agg(story ORDER BY story.rank) FROM (
          SELECT ${fields}, r.rank, r.is_recent, ${cardRankHistorySQL} AS rank_history
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
}

const cachedReadyStorySelection = boundedCache(queryReadyStorySelection, cachePolicy.selection);

const freshReadyStorySelection = boundedCache(queryReadyStorySelection, cachePolicy.freshSelection);

type ReadySnapshotRow = CardStory & { snapshot_ready: boolean; rank_history: RankObservation[] };

async function getReadySnapshotStories(
  items: ReadyStorySnapshotItem[],
  observedAt: string,
): Promise<(CardStory & { rank_history: RankObservation[] })[]> {
  const result = await readStories("feed", async (client, fields) => {
    return client.query<ReadySnapshotRow>(
      `SELECT ${fields}, selected.rank::text AS rank, selected.is_recent,
        ${cardRankHistoryAtSQL} AS rank_history,
        (r.hn_id IS NOT NULL AND ${readySummarySQL}) AS snapshot_ready
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
        observedAt,
      ],
    );
  });
  if (result.rows.length !== items.length || result.rows.some((story) => !story.snapshot_ready))
    throw new ReadyStoryPageError("snapshot_invalidated");
  return result.rows.map(({ snapshot_ready: _snapshotReady, ...story }) => story);
}

// Cursor pages are public but unbounded in cardinality. Keep only a small LRU
// and cap concurrent misses so random continuation values cannot exhaust the pool.
const cachedReadySnapshotStories = boundedCache(async (key: string) => {
  const separator = key.indexOf("|");
  const observedAt = key.slice(0, separator);
  const records = key.slice(separator + 1).split(";");
  return getReadySnapshotStories(
    records.map((record) => {
      const [hn_id, rank, recent] = record.split(",");
      return { hn_id, rank, is_recent: recent === "1" };
    }),
    observedAt,
  );
}, cachePolicy.snapshotPage);

function cachedReadySnapshotPage(observedAt: string, items: ReadyStorySnapshotItem[]) {
  return cachedReadySnapshotStories(
    `${observedAt}|${items.map((item) => `${item.hn_id},${item.rank},${item.is_recent ? 1 : 0}`).join(";")}`,
  ).catch((error) => {
    if (error instanceof ReadyStoryPageError || error instanceof DataUnavailableError) throw error;
    throw new DataUnavailableError();
  });
}

function loadReadyStorySelection(fresh = false) {
  return (fresh ? freshReadyStorySelection : cachedReadyStorySelection)("ready-stories").catch(
    (error) => {
      if (error instanceof ReadyStoryPageError || error instanceof DataUnavailableError)
        throw error;
      throw new DataUnavailableError();
    },
  );
}

export async function getCurrentReadySelectionIds(): Promise<string[]> {
  const selection = await loadReadyStorySelection(true);
  return selection.items.map((item) => item.hn_id);
}

export type ReadyStoryPage = {
  stories: (CardStory & { rank_history: RankObservation[] })[];
  ingestion: Date | null;
  observed_at: string;
  selectionIds: string[];
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
  fresh = false,
}: {
  cursor?: string;
  page?: number;
  pageSize?: number;
  fresh?: boolean;
} = {}): Promise<ReadyStoryPage> {
  if (fresh && (cursor !== undefined || (page !== undefined && page !== 1)))
    throw new ReadyStoryPageError("invalid_cursor");
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
      selectionIds: snapshot.items.map((item) => item.hn_id),
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
  const selection = await loadReadyStorySelection(fresh);
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
    selectionIds: items.map((item) => item.hn_id),
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

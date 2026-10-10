import "server-only";
import { cachePolicy } from "./cache-policy";
import { read } from "./read";
import { readStories, storySlugField } from "./capabilities";
import { getLeaderboard } from "./ranked";
import { boundedCache } from "../bounded-cache";
import { DataUnavailableError } from "../data-availability";
import { readySummarySQL } from "../ready-stories";
import type { CardStory, ExportStory } from "../story-domain";
import {
  cardRankHistorySQL,
  rankHistoryAtSQL,
  rankHistorySQL,
  type RankObservation,
} from "../rank-history";

export async function getSitemapStories(): Promise<
  { hn_id: string; story_slug: string | null; modified_at: Date }[]
> {
  return read(async (client) => {
    // Include current and archived stories only once a takeaway is published,
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
      WHERE t.hn_id BETWEEN 1 AND 999999999999999 AND ${readySummarySQL}
      ORDER BY t.hn_id`);
    return result.rows;
  });
}

const cachedFeedStories = boundedCache(async (): Promise<CardStory[]> => {
  return readStories("feed", async (client, fields) => {
    const result =
      await client.query<CardStory>(`SELECT ${fields}, r.rank, ${cardRankHistorySQL} AS rank_history,
      to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at
      FROM hacker_news_threads t LEFT JOIN hacksnap_summaries s ON s.story_id = t.hn_id
      LEFT JOIN hacksnap_ranked_stories r ON r.hn_id = t.hn_id
      WHERE t.hn_id BETWEEN 1 AND 999999999999999
      ORDER BY t.date_added DESC, t.hn_id DESC LIMIT 50`);
    return result.rows;
  });
}, cachePolicy.feed);

export function getFeedStories(): Promise<CardStory[]> {
  return cachedFeedStories("feed");
}

// RSS keeps its documented article and discussion text without making cards
// retain those bodies. Its existing five-minute cache remains independent.
const cachedRssStories = boundedCache(
  async (): Promise<ExportStory[]> =>
    readStories(
      "export",
      async (client, fields) =>
        (
          await client.query<ExportStory>(`SELECT ${fields}, r.rank,
        ${rankHistorySQL} AS rank_history,
        to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at
        FROM hacker_news_threads t LEFT JOIN hacksnap_summaries s ON s.story_id = t.hn_id
        LEFT JOIN hacksnap_ranked_stories r ON r.hn_id = t.hn_id
        WHERE t.hn_id BETWEEN 1 AND 999999999999999
        ORDER BY t.date_added DESC, t.hn_id DESC LIMIT 50`)
        ).rows,
    ),
  cachePolicy.feed,
);

export function getRssStories(): Promise<ExportStory[]> {
  return cachedRssStories("rss");
}

// Homepage Markdown presents every observed position within the 24-hour window.
// Keep that history out of the cached HTML cards and attach it only on demand.
const cachedMarkdownHistories = boundedCache(
  async (key: string): Promise<Map<string, RankObservation[]>> => {
    const separator = key.indexOf("|");
    const observedAt = key.slice(0, separator);
    const ids = key
      .slice(separator + 1)
      .split(",")
      .filter(Boolean);
    if (!ids.length) return new Map();
    const histories = await read(
      async (client) =>
        (
          await client.query<{ hn_id: string; rank_history: RankObservation[] }>(
            `SELECT t.hn_id, ${rankHistoryAtSQL} AS rank_history
         FROM hacker_news_threads t WHERE t.hn_id = ANY($1::bigint[])`,
            [ids, observedAt],
          )
        ).rows,
    );
    return new Map(histories.map((row) => [String(row.hn_id), row.rank_history]));
  },
  cachePolicy.markdownHistory,
);

export async function getMarkdownLeaderboard() {
  const leaderboard = await getLeaderboard();
  const key = `${leaderboard.observed_at}|${leaderboard.stories.map((story) => story.hn_id).join(",")}`;
  let byId: Map<string, RankObservation[]>;
  try {
    byId = await cachedMarkdownHistories(key);
  } catch {
    throw new DataUnavailableError();
  }
  return {
    ...leaderboard,
    stories: leaderboard.stories.map((story) => ({
      ...story,
      rank_history: byId.get(story.hn_id) ?? [],
    })),
  };
}

import "server-only";
import { cachePolicy } from "./cache-policy";
import { cache } from "react";
import { read } from "./read";
import { readStories, storySlugField } from "./capabilities";
import { boundedCache } from "../bounded-cache";
import { DataUnavailableError } from "../data-availability";
import { validStoryId } from "../public-story";
import type { ArticleStory } from "../story-domain";
import { storyMetricsSQL, type RankingMetrics } from "../story-metrics";
import {
  popularityAvailableSQL,
  weeklyPopularityAvailableSQL,
  popularStoriesSQL,
  type PopularStory,
  type PopularPeriod,
} from "../popular-stories";

const cachedPopularStories = boundedCache(async (key: string): Promise<PopularStory[]> => {
  const period: PopularPeriod = key === "last-7-days" ? "last-7-days" : "all-time";
  return read(
    async (client) => {
      const { rows } = await client.query<{ available: boolean }>(
        period === "last-7-days" ? weeklyPopularityAvailableSQL : popularityAvailableSQL,
      );
      if (rows[0]?.available !== true) {
        if (period === "last-7-days") throw new DataUnavailableError();
        return [];
      }
      return (
        await client.query<PopularStory>(popularStoriesSQL(await storySlugField(client), period))
      ).rows;
    },
    // A slow aggregate must not occupy the pool used by other requests' pages.
    period === "last-7-days" ? "hacksnapTrendingPool" : "hacksnapPool",
  );
}, cachePolicy.popular);

export async function getPopularStories(
  period: PopularPeriod = "all-time",
): Promise<PopularStory[]> {
  if (!process.env.HACKSNAP_WEB_DATABASE_URL) return [];
  return cachedPopularStories(period);
}

// Cache expensive renderer reads across requests, including negotiated Markdown.
const cachedStory = boundedCache(async (id: string): Promise<ArticleStory | null> => {
  return readStories("story", async (client, fields) => {
    const result = await client.query<ArticleStory>(
      `SELECT ${fields}
      FROM hacker_news_threads t LEFT JOIN hacksnap_summaries s ON s.story_id = t.hn_id
      WHERE t.hn_id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  });
}, cachePolicy.story);

// Share the result between page metadata and rendering within the same request.
export const getStory = cache(async (id: string): Promise<ArticleStory | null> => {
  if (!validStoryId(id)) return null;
  try {
    return await cachedStory(id);
  } catch {
    throw new DataUnavailableError();
  }
});

const cachedStoryMetrics = boundedCache(
  async (id: string): Promise<RankingMetrics | null> =>
    read(
      async (client) =>
        (
          await client.query<{ ranking_metrics: RankingMetrics }>(
            `SELECT ${storyMetricsSQL} AS ranking_metrics FROM hacker_news_threads t WHERE t.hn_id = $1`,
            [id],
          )
        ).rows[0]?.ranking_metrics ?? null,
    ),
  cachePolicy.metrics,
);

export async function getStoryMetrics(id: string): Promise<RankingMetrics | null> {
  if (!validStoryId(id)) return null;
  try {
    return await cachedStoryMetrics(id);
  } catch {
    throw new DataUnavailableError();
  }
}

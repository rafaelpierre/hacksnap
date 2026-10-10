import "server-only";
import { cachePolicy } from "./cache-policy";
import { cache } from "react";
import { read } from "./read";
import { readBrowseStories, storySlugField } from "./capabilities";
import { boundedCache } from "../bounded-cache";
import { DataUnavailableError } from "../data-availability";
import { validStoryId } from "../public-story";
import type { ArticleStory, CardStory } from "../story-domain";
import {
  ARCHIVE_PAGE_SIZE,
  MAX_BROWSE_PAGE,
  assertBrowsePage,
  archiveMonthsSQL,
  archiveQuery,
} from "../archive";
import {
  CATEGORY_PAGE_SIZE,
  categoryCountsSQL,
  categoryById,
  categoryQuery,
  relatedStoriesQuery,
  type CategoryId,
  type CategoryCounts,
} from "../categories";

function browseResult<T>(result: Promise<T>): Promise<T> {
  return result.catch(() => {
    throw new DataUnavailableError();
  });
}

function assertCategory(category: CategoryId): void {
  if (!categoryById(category)) throw new RangeError("Invalid category");
}

const cachedArchiveMonths = boundedCache(
  async (): Promise<{ month: string; count: number }[]> =>
    read(
      async (client) =>
        (await client.query<{ month: string; count: number }>(archiveMonthsSQL)).rows,
    ),
  cachePolicy.months,
);

export const getArchiveMonths = cache(async () => browseResult(cachedArchiveMonths("all")));

const cachedCategoryCounts = boundedCache(
  async (): Promise<CategoryCounts> =>
    read(async (client) => {
      const { rows } = await client.query<{ category: CategoryId; count: number }>(
        categoryCountsSQL,
      );
      return Object.fromEntries(rows.map((row) => [row.category, row.count]));
    }),
  cachePolicy.counts,
);

export const getCategoryCounts = cache(async () => browseResult(cachedCategoryCounts("all")));

const cachedCategoryStories = boundedCache(async (key: string) => {
  const [categoryId, pageText] = key.split(":");
  const category = categoryById(categoryId);
  if (!category) throw new RangeError("Invalid category");
  const page = Number(pageText);
  return readBrowseStories(async (client, fields) => {
    const { rows } = await client.query<CardStory>(categoryQuery(fields, category.id, page));
    return {
      stories: rows.slice(0, CATEGORY_PAGE_SIZE),
      hasNext: page < MAX_BROWSE_PAGE && rows.length > CATEGORY_PAGE_SIZE,
    };
  });
}, cachePolicy.browse);

export const getCategoryStories = cache(async (category: CategoryId, page: number) => {
  assertCategory(category);
  assertBrowsePage(page);
  return browseResult(cachedCategoryStories(`${category}:${page}`));
});

export type RelatedStory = Pick<
  ArticleStory,
  "hn_id" | "title" | "url" | "date_added" | "story_slug"
> & {
  takeaway: string;
};

const cachedRelatedStories = boundedCache(async (key: string): Promise<RelatedStory[]> => {
  const [categoryId, currentStoryId] = key.split(":");
  const category = categoryById(categoryId);
  if (!category) throw new RangeError("Invalid category");
  return read(
    async (client) =>
      (
        await client.query<RelatedStory>(
          relatedStoriesQuery(category.id, currentStoryId, await storySlugField(client)),
        )
      ).rows,
  );
}, cachePolicy.related);

export const getRelatedStories = cache(async (category: CategoryId, currentStoryId: string) => {
  assertCategory(category);
  if (!validStoryId(currentStoryId)) throw new RangeError("Invalid story ID");
  return browseResult(cachedRelatedStories(`${category}:${currentStoryId}`));
});

const cachedArchiveStories = boundedCache(async (key: string) => {
  const separator = key.lastIndexOf(":");
  const month = key.slice(0, separator) || null;
  const page = Number(key.slice(separator + 1));
  return readBrowseStories(async (client, fields) => {
    const result = await client.query<CardStory>(archiveQuery(fields, month, page));
    return {
      stories: result.rows.slice(0, ARCHIVE_PAGE_SIZE),
      hasNext: page < MAX_BROWSE_PAGE && result.rows.length > ARCHIVE_PAGE_SIZE,
    };
  });
}, cachePolicy.browse);

export const getArchiveStories = cache(async (month: string | null, page: number) => {
  if (month !== null && !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month))
    throw new RangeError("Invalid archive month");
  assertBrowsePage(page);
  return browseResult(cachedArchiveStories(`${month ?? ""}:${page}`));
});

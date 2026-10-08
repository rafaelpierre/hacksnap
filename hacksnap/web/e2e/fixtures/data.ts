import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import type { ArticleStory, CardStory, ExportStory } from "../../lib/story-domain";
import type { CategoryId, CategoryCounts } from "../../lib/categories";
import type { RankingMetrics } from "../../lib/story-metrics";
import type { PublicStory } from "../../lib/public-story";
import { DataUnavailableError } from "../../lib/data-availability";
import { ARCHIVE_PAGE_SIZE } from "../../lib/archive";
import { CATEGORY_PAGE_SIZE } from "../../lib/categories";
import {
  createReadyStoryCursor,
  parseReadyStoryCursor,
  assertReadyStoryPage,
  assertReadyStoryPageSize,
} from "../../lib/ready-story-pagination";

export type { ArticleStory, CardStory, ExportStory } from "../../lib/story-domain";
export type {
  DiscussionAnalysis,
  DiscussionAnalysisPreview,
  DiscussionAnalysisCoverage,
} from "../../lib/discussion-analysis";
export type Story = ArticleStory;
export type Summary = NonNullable<ArticleStory["summary"]>;
export type RelatedStory = Pick<
  ArticleStory,
  "hn_id" | "title" | "url" | "date_added" | "story_slug"
> & { takeaway: string };
const timestamp = "2026-01-15T12:00:00.000Z";
const stories: ArticleStory[] = Array.from({ length: 40 }, (_, i) => ({
  hn_id: String(91000001 + i),
  story_slug: null,
  title:
    i === 0 ? "Small models make local tools more useful" : `Practical AI research update ${i + 1}`,
  category: "models_products",
  url: "https://example.com/research",
  image_url: "https://fixture.public.blob.vercel-storage.com/articles/browser.webp",
  image_status: "ready",
  image_width: 1600,
  image_height: 900,
  image_mime_type: "image/webp",
  points: 120 - i,
  comment_count: 30,
  date_added: new Date(timestamp),
  summary: {
    overall_takeaway:
      "Local models can help teams build useful tools while keeping their data close.",
    sentiment: 0,
    article_summary:
      "Researchers compared small models on a repeatable set of development tasks. The results show useful improvements with clear limits on reliability.",
    article_key_points: [
      "The evaluation uses repeatable tasks.",
      "Small models reduce deployment costs.",
    ],
    discussion_summary:
      "Readers discuss practical deployment, measurement quality, and the cost of maintaining local tools.",
    discussion_points: [],
    generated_at: timestamp,
    model: "browser-fixture",
    source_coverage: {
      stored_comments: 30,
      included_comments: 12,
      comments_truncated: true,
      article_status: "fetched",
    },
    discussion_analyzed_at: timestamp,
    discussion_analysis_coverage: {
      stored_comments: 30,
      included_comments: 12,
      comments_truncated: true,
      selection_method: "active_branches_with_ancestors_v1",
    },
    discussion_analysis: {
      status: "available",
      reference_claims: [
        { id: "claim-1", source: "article", text: "Local models can reduce deployment costs." },
      ],
      topics: [
        {
          key: "evidence",
          title: "Measuring useful work",
          summary: "Readers ask for repeatable measurements of realistic tasks.",
          comment_ids: [92000001, 92000002],
        },
      ],
      critical_comments: [
        {
          comment_id: 92000001,
          claim_id: "claim-1",
          stance: "qualified_disagreement",
          paraphrase: "Maintenance costs still matter.",
          explanation: "The comparison omits ongoing support time.",
        },
      ],
      supportive_comments: [
        {
          comment_id: 92000002,
          claim_id: "claim-1",
          stance: "qualified_agreement",
          paraphrase: "Local deployment helps small teams.",
          explanation: "Predictable tasks can run with modest hardware.",
        },
      ],
    },
  },
}));
const cards = stories.map((story, index) => ({
  ...story,
  rank: String(index + 1),
  rank_history: [],
  is_recent: true,
}));
export async function getReadyStoryPage({
  cursor,
  page,
  pageSize,
}: { cursor?: string; page?: number; pageSize?: number; fresh?: boolean } = {}) {
  const snapshot = cursor ? parseReadyStoryCursor(cursor) : null;
  const size = snapshot?.pageSize ?? assertReadyStoryPageSize(pageSize);
  const currentPage = snapshot ? snapshot.offset / size + 1 : assertReadyStoryPage(page);
  const offset = (currentPage - 1) * size;
  const items = cards.map(({ hn_id, rank, is_recent }) => ({ hn_id, rank, is_recent }));
  const expiresAt = snapshot?.expiresAt ?? new Date(Date.now() + 8 * 3600_000).toISOString();
  const makeCursor = (nextOffset: number) =>
    createReadyStoryCursor({
      items,
      offset: nextOffset,
      pageSize: size,
      observedAt: timestamp,
      ingestion: timestamp,
      selectionLimited: false,
      expiresAt: new Date(expiresAt),
    });
  const hasMore = offset + size < cards.length;
  return {
    stories: cards.slice(offset, offset + size),
    ingestion: new Date(),
    observed_at: timestamp,
    selectionIds: items.map(({ hn_id }) => hn_id),
    pagination: {
      cursor: hasMore ? makeCursor(offset + size) : null,
      hasMore,
      page: currentPage,
      previousCursor: offset > 0 ? makeCursor(Math.max(0, offset - size)) : null,
      expiresAt,
      selectionLimited: false,
    },
  };
}
export type ReadyStoryPage = Awaited<ReturnType<typeof getReadyStoryPage>>;
export async function getLeaderboard() {
  return getReadyStoryPage();
}
export async function getCurrentReadySelectionIds() {
  return cards.map(({ hn_id }) => hn_id);
}
export async function getPopularStories(period: "last-7-days" | "all-time" = "all-time") {
  const cookie = (await headers()).get("cookie") ?? "";
  if (cookie.includes("fixture-popularity=slow"))
    await new Promise((resolve) => setTimeout(resolve, 2500));
  if (cookie.includes("fixture-popularity=failed")) throw new DataUnavailableError();
  if (cookie.includes("fixture-popularity=weekly-failed") && period === "last-7-days")
    throw new DataUnavailableError();
  if (cookie.includes("fixture-popularity=empty")) return [];
  const popular = cookie.includes("fixture-popularity=outside-feed")
    ? cards.slice(-5)
    : period === "last-7-days"
      ? cards.slice(5, 10)
      : cards.slice(0, 5);
  return popular.map(({ hn_id, title, story_slug }, index) => ({
    hn_id,
    title,
    story_slug,
    views: String(322 - index * 50),
  }));
}
export async function getMarkdownLeaderboard() {
  return getReadyStoryPage();
}
export async function getApiLeaderboard() {
  return { stories: stories.slice(0, 10), ingestion: new Date(timestamp) };
}
export async function getFeedStories(): Promise<CardStory[]> {
  return cards;
}
export async function getRssStories(): Promise<ExportStory[]> {
  return stories;
}
export const getStory = cache(async (id: string): Promise<ArticleStory | null> => {
  if (id === "91999999") throw new DataUnavailableError();
  const story = stories.find((story) => story.hn_id === id) ?? null;
  const cookie = (await headers()).get("cookie") ?? "";
  if (id === "91000001" && cookie.includes("fixture-story=slow"))
    await new Promise((resolve) => setTimeout(resolve, 11_000));
  if (story && id === "91000001" && cookie.includes("fixture-story=redirect")) {
    return { ...story, story_slug: `canonical-story-${id}` };
  }
  return story;
});
export async function getPublicStory(id: string): Promise<PublicStory | null> {
  return getStory(id);
}
export async function getStoryMetrics(_id: string): Promise<RankingMetrics | null> {
  return null;
}
export async function getArchiveMonths() {
  return [{ month: "2026-01", count: stories.length }];
}
export async function getCategoryCounts(): Promise<CategoryCounts> {
  return { models_products: stories.length };
}
export async function getCategoryStories(category: CategoryId, page: number) {
  if (category === "safety_privacy") return { stories: [], hasNext: false };
  return {
    stories: cards.slice((page - 1) * CATEGORY_PAGE_SIZE, page * CATEGORY_PAGE_SIZE),
    hasNext: page * CATEGORY_PAGE_SIZE < cards.length,
  };
}
export async function getArchiveStories(_month: string | null, page: number) {
  return {
    stories: cards.slice((page - 1) * ARCHIVE_PAGE_SIZE, page * ARCHIVE_PAGE_SIZE),
    hasNext: page * ARCHIVE_PAGE_SIZE < cards.length,
  };
}
export async function getRelatedStories(
  _category: CategoryId,
  id: string,
): Promise<RelatedStory[]> {
  // This dedicated fixture proves optional Suspense data does not delay the article.
  if (id === "91000002") await new Promise((resolve) => setTimeout(resolve, 2500));
  if (id === "91000003") throw new DataUnavailableError();
  return stories
    .filter((story) => story.hn_id !== id)
    .slice(0, 2)
    .map((story) => ({ ...story, takeaway: story.summary!.overall_takeaway }));
}
export async function getSitemapStories() {
  return stories.map(({ hn_id, story_slug }) => ({
    hn_id,
    story_slug: story_slug ?? null,
    modified_at: new Date(timestamp),
  }));
}

import type { CategoryId } from "./categories";
import type { DiscussionFields, DiscussionAnalysisPreview } from "./discussion-analysis";
import type { RankObservation } from "./rank-history";
import type { StoryImageFields } from "./story-image";
import type { RankingMetrics } from "./story-metrics";

export type SourceCoverage = {
  stored_comments: number;
  included_comments: number;
  comments_truncated: boolean;
  article_status: "fetched" | "unavailable" | "not_applicable";
  sentiment?: { included_comments: number };
};

export type StoryIdentity = StoryImageFields & {
  hn_id: string;
  title: string;
  story_slug?: string | null;
  category: CategoryId | null;
  url: string;
  points: number;
  comment_count: number;
  date_added: Date;
};

export type CardSummary = {
  overall_takeaway: string;
  discussion_preview?: string | null;
  sentiment: -1 | 0 | 1 | null;
  source_coverage: SourceCoverage;
  // Older in-memory fixtures may still carry this unused field. Card SQL omits it.
  discussion_analysis_preview?: DiscussionAnalysisPreview | null;
};

export type CardStory = StoryIdentity & {
  summary: CardSummary | null;
  rank?: string;
  is_recent?: boolean;
  // The two latest captures are sufficient for the card movement badge.
  rank_history?: RankObservation[];
  observed_at?: string;
};

export type ArticleSummary = CardSummary &
  DiscussionFields & {
    article_summary: string | null;
    article_key_points: string[];
    discussion_summary: string;
    discussion_points: { title: string; summary: string; comment_ids: number[] }[];
    generated_at: string;
    model: string;
  };

export type ArticleStory = StoryIdentity & {
  summary: ArticleSummary | null;
};

export type MetricsStory = ArticleStory & { ranking_metrics: RankingMetrics };

// RSS and the public list have their own source contract, independent of cards.
export type ExportStory = StoryIdentity & {
  summary:
    | (Pick<ArticleSummary, "article_summary" | "discussion_summary" | "overall_takeaway"> &
        Pick<CardSummary, "sentiment" | "source_coverage">)
    | null;
  rank?: string;
  is_recent?: boolean;
  rank_history?: RankObservation[];
  observed_at?: string;
};

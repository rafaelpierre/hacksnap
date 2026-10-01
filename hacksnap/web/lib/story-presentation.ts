import { articleURL } from "./format";
import type { Summary } from "./data";

type SourceSummary = Pick<Summary, "article_summary" | "source_coverage">;
type DiscussionSummary = Pick<
  Summary,
  | "discussion_summary"
  | "discussion_points"
  | "discussion_analysis"
  | "source_coverage"
  | "discussion_analysis_coverage"
>;

/** Source identity comes from the validated link, not from a missing brief. */
export function storySource(url: string, summary: SourceSummary | null) {
  const article = articleURL(url);
  return {
    article,
    kind: article ? ("article" as const) : ("hn_post" as const),
    brief: summary?.article_summary?.trim()
      ? ("available" as const)
      : !summary
        ? ("pending" as const)
        : article && summary.source_coverage.article_status === "unavailable"
          ? ("unavailable" as const)
          : ("missing" as const),
  };
}

/** Analysis has its own refresh and sample; legacy points describe the older brief. */
export function storyDiscussion(summary: DiscussionSummary | null) {
  if (!summary) return { kind: "pending" as const, topics: [], coverage: null };
  if (summary.discussion_analysis) {
    return {
      kind: "analysis" as const,
      analysis: summary.discussion_analysis,
      status: summary.discussion_analysis.status,
      topics: summary.discussion_analysis.topics,
      coverage: summary.discussion_analysis_coverage ?? null,
      legacyCoverage: summary.source_coverage,
    };
  }
  return {
    kind:
      summary.source_coverage.included_comments > 0 && summary.discussion_summary.trim()
        ? ("legacy" as const)
        : ("legacy_empty" as const),
    topics: summary.discussion_points,
    coverage: summary.source_coverage,
  };
}

/** Public version-one contract. Counts describe selected evidence, not community opinion. */
export type ReferenceClaim = {
  id: string;
  text: string;
  source: "article" | "story_text";
};

export type CommentHighlight = {
  comment_id: number;
  claim_id: string;
  paraphrase: string;
  explanation: string;
};
export type CriticalCommentHighlight = CommentHighlight & {
  stance: "disagrees" | "qualified_disagreement";
};
export type SupportiveCommentHighlight = CommentHighlight & {
  stance: "agrees" | "qualified_agreement";
};
export type DiscussionTopic = {
  key:
    | "applicability"
    | "evidence"
    | "technical_limitations"
    | "cost"
    | "ethics"
    | "privacy_security"
    | "social_impact"
    | "alternatives"
    | "other";
  title: string;
  summary: string;
  comment_ids: number[];
};
export type DiscussionAnalysis = {
  status: "available" | "no_comments" | "insufficient_context";
  reference_claims: ReferenceClaim[];
  critical_comments: CriticalCommentHighlight[];
  supportive_comments: SupportiveCommentHighlight[];
  topics: DiscussionTopic[];
};
export type DiscussionAnalysisCoverage = {
  stored_comments: number;
  included_comments: number;
  comments_truncated: boolean;
  selection_method: "active_branches_with_ancestors_v1";
};
export type DiscussionAnalysisPreview = {
  status: DiscussionAnalysis["status"];
  topics: Pick<DiscussionTopic, "key" | "title" | "summary">[];
  selected_evidence: { critical: number; supportive: number };
};

export type DiscussionFields = {
  // Missing fields from legacy fixtures/cache entries mean unavailable, never pending backfill.
  discussion_analysis?: DiscussionAnalysis | null;
  discussion_analysis_preview?: DiscussionAnalysisPreview | null;
  discussion_analyzed_at?: string | null;
  discussion_analysis_coverage?: DiscussionAnalysisCoverage | null;
};

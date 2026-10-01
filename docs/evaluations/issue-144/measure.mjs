import { readFileSync } from "node:fs";

const fixtures = JSON.parse(
  readFileSync(new URL("../../../hacksnap/fixtures/discussion-analysis/valid.json", import.meta.url)),
);
const analysis = fixtures[0].expected;
const source_coverage = {
  stored_comments: 330,
  included_comments: 140,
  comments_truncated: true,
  article_status: "fetched",
  sentiment: { included_comments: 94 },
};
const rank_history = Array.from({ length: 24 }, (_, hour) => ({
  observed_at: new Date(Date.UTC(2026, 8, 30, hour)).toISOString(),
  rank: 11 - (hour % 9),
}));
const identity = {
  hn_id: "45987612",
  title: "A representative AI release and the difficult engineering questions behind it",
  url: "https://example.com/research/representative-release",
  points: 341,
  comment_count: 212,
  date_added: "2026-09-30T10:10:00.000Z",
  category: "models_products",
  image_url: "https://example.public.blob.vercel-storage.com/image.avif",
  image_status: "ready",
  image_width: 1200,
  image_height: 675,
  image_mime_type: "image/avif",
  story_slug: "representative-ai-release",
};
const fullSummary = {
  article_summary: "A research team published a new model with changes to its training pipeline and evaluation methodology. ".repeat(12),
  article_key_points: Array.from({ length: 5 }, (_, index) =>
    `Technical finding ${index + 1}: the benchmark reveals an important tradeoff under production load.`,
  ),
  discussion_summary: "Commenters scrutinized the baseline, deployment cost, benchmark coverage and reproducibility. ".repeat(11),
  discussion_points: Array.from({ length: 4 }, (_, index) => ({
    title: `Topic ${index + 1}`,
    summary: "The discussion makes a substantive point about testing, costs, and practical reliability. ".repeat(3),
    comment_ids: [101 + index, 201 + index],
  })),
  sentiment: -1,
  overall_takeaway: "The release is promising, but its strongest claims depend on narrow benchmarks and unclear deployment costs.",
  generated_at: "2026-09-30T12:00:00Z",
  model: "example-model",
  source_coverage,
  discussion_analysis: analysis,
  discussion_analyzed_at: "2026-09-30T12:00:00Z",
  discussion_analysis_coverage: {
    stored_comments: 330,
    included_comments: 140,
    comments_truncated: true,
    selection_method: "active_branches_with_ancestors_v1",
  },
};
const oldCard = {
  ...identity,
  rank: "3",
  is_recent: true,
  rank_history,
  summary: {
    ...fullSummary,
    discussion_analysis: undefined,
    discussion_analysis_preview: {
      status: analysis.status,
      topics: analysis.topics.map(({ key, title, summary }) => ({ key, title, summary })),
      selected_evidence: {
        critical: analysis.critical_comments.length,
        supportive: analysis.supportive_comments.length,
      },
    },
  },
};
const newCard = {
  ...identity,
  rank: "3",
  is_recent: true,
  rank_history: rank_history.slice(-2),
  summary: {
    overall_takeaway: fullSummary.overall_takeaway,
    sentiment: fullSummary.sentiment,
    source_coverage,
  },
};
const ranking_metrics = {
  peak_rank: 2,
  observation_count: 500,
  first_observed_at: "2026-08-01T00:00:00Z",
  last_observed_at: "2026-09-30T23:00:00Z",
  top_ten_hours: 80,
  history: rank_history,
};
const oldArticle = {
  ...identity,
  rank: "3",
  rank_history,
  summary: fullSummary,
  ranking_metrics,
  observed_at: "2026-09-30T23:00:00Z",
};
const newArticle = { ...identity, summary: fullSummary };
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
console.log(
  JSON.stringify({
    card: { before: bytes(oldCard), after: bytes(newCard) },
    article: { before: bytes(oldArticle), after: bytes(newArticle) },
  }),
);

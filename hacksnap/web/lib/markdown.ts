import { archiveURL, monthLabel } from "./archive.ts";
import { canonicalStoryUrl } from "./story-url";
import type { ArticleStory, CardStory } from "./story-domain";
import type { RankingMetrics } from "./story-metrics";
import type { DiscussionFields } from "./discussion-analysis";
import { hasReadySummary } from "./ready-stories.ts";
import { storyIndicators } from "./story-indicators.ts";
import { storyMetricsText } from "./story-metrics.ts";
import { categoryById, categoryURL } from "./categories.ts";
import { storyDiscussion, storySource } from "./story-presentation.ts";

// Match product tokens, not generic browser strings or lookalike bot names.
export function isAiAgent(userAgent: string | null): boolean {
  return /(?:^|[^a-z0-9_-])(?:ChatGPT-User|OAI-SearchBot|GPTBot|Claude-User|Claude-SearchBot|ClaudeBot|PerplexityBot|Perplexity-User)(?=\/|[^a-z0-9_-]|$)/i.test(
    userAgent ?? "",
  );
}

// Wildcards alone keep the browser default. An explicit Markdown preference
// must be acceptable and at least as preferred as HTML.
export function acceptsMarkdown(accept: string | null): boolean {
  const ranges = (accept ?? "").split(",").map((part) => {
    const [type, ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const quality = q ? Number(q.slice(2)) : 1;
    return {
      type: type.trim(),
      quality: Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0,
    };
  });
  const markdown = Math.max(
    0,
    ...ranges.filter((r) => r.type === "text/markdown").map((r) => r.quality),
  );
  const htmlRange = ["text/html", "text/*", "*/*"]
    .map((type) => ranges.filter((r) => r.type === type))
    .find((matches) => matches.length);
  const html = htmlRange ? Math.max(...htmlRange.map((r) => r.quality)) : 0;
  return markdown > 0 && markdown >= html;
}

function text(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/([\\`*_{}[\]<>#+.!|~-])/g, "\\$1");
}

function link(label: string, url: string): string {
  return `[${text(label)}](<${url.replace(/[<>\s]/g, (c) => encodeURIComponent(c))}>)`;
}

function discussionMarkdown(summary: DiscussionFields): string[] {
  const analysis = summary.discussion_analysis;
  if (!analysis) return [];
  const coverage = summary.discussion_analysis_coverage;
  const lines = [
    summary.discussion_analyzed_at
      ? `Analyzed: ${text(summary.discussion_analyzed_at)}`
      : "Analysis time unavailable.",
    coverage
      ? `Analysis sample: Based on ${coverage.included_comments} of ${coverage.stored_comments} usable stored comments. Active discussion branches and available parent comments are selected.${coverage.comments_truncated ? " The analysis input was further shortened to fit its context limit." : ""}`
      : "Analyzed-comment count unavailable.",
    "This sample may omit parts of the full thread. Selected themes do not measure community opinion or how common a view is.",
  ];
  if (analysis.status === "no_comments") {
    lines.push(
      "No usable comments were available for this analysis, so no themes could be selected.",
    );
    return lines;
  }
  for (const topic of analysis.topics) {
    lines.push(`### ${text(topic.title)}`, text(topic.summary));
    if (topic.comment_ids.length)
      lines.push(
        "Sources: " +
          topic.comment_ids
            .map((id) => link(`Comment ${id}`, `https://news.ycombinator.com/item?id=${id}`))
            .join(" · "),
      );
  }
  if (!analysis.topics.length)
    lines.push("No distinct themes were identified in the analyzed comments.");
  return lines;
}

export function storyMarkdown(
  story: ArticleStory & {
    ranking_metrics?: RankingMetrics | null;
    rank?: string;
    rank_history?: CardStory["rank_history"];
    observed_at?: string;
  },
): string {
  const summary = story.summary;
  const source = storySource(story.url, summary);
  const article = source.article;
  const discussion = storyDiscussion(summary);
  const category = categoryById(story.category);
  const lines = [
    `# ${text(story.title)}`,
    `${story.points} points · ${story.comment_count} comments`,
    link("Full discussion", `https://news.ycombinator.com/item?id=${story.hn_id}`),
  ];
  if (article) lines.push(link("Read original", article));
  if (category)
    lines.push(
      `Category: ${link(category.label, `https://hacksnap.live${categoryURL(category)}`)}`,
    );
  if (!story.ranking_metrics)
    lines.push(
      storyIndicators(story, story.observed_at ?? new Date().toISOString())
        .map(text)
        .join("\n\n"),
    );
  lines.push("## Skept-o-meter & Hotness", storyMetricsText(story).map(text).join("\n\n"));
  if (!summary)
    return [
      ...lines,
      "## Summary pending",
      "Summaries update hourly. You can read the original sources above.",
      "",
    ].join("\n\n");
  lines.push(
    text(summary.overall_takeaway),
    source.kind === "article" ? "## The brief" : "## The post",
    source.brief === "available" && summary.article_summary
      ? text(summary.article_summary)
      : source.brief === "unavailable"
        ? "The original article couldn’t be retrieved. This brief covers the discussion only."
        : source.kind === "article"
          ? "No article brief is available. You can read the original source and the discussion."
          : "This is an HN post. The discussion is summarized below.",
  );
  if (source.brief === "available" && summary.article_key_points.length)
    lines.push(summary.article_key_points.map((p) => `- ${text(p)}`).join("\n"));
  lines.push("## Discussion themes");
  if (discussion.kind === "legacy_empty")
    lines.push("No usable discussion was available for this summary.");
  if (discussion.kind === "analysis") lines.push(...discussionMarkdown(summary));
  if (discussion.kind === "legacy" && !discussion.topics.length)
    lines.push("No distinct themes were identified in this summary.");
  for (const point of discussion.kind === "legacy" ? discussion.topics : []) {
    lines.push(`### ${text(point.title)}`, text(point.summary));
    if (point.comment_ids.length)
      lines.push(
        "Sources: " +
          point.comment_ids
            .map((id) => link(`Comment ${id}`, `https://news.ycombinator.com/item?id=${id}`))
            .join(" · "),
      );
  }
  const coverage = summary.source_coverage;
  lines.push(
    "## Sources & coverage",
    `AI-generated summary · ${text(summary.generated_at)}`,
    `Based on ${coverage.included_comments} of ${coverage.stored_comments} usable stored comments, selected by depth and branch activity. This is a sample of the discussion.${coverage.comments_truncated ? " The model input was further shortened to fit its context limit." : ""} Article text may also be shortened.`,
    `Generated using ${text(summary.model)}. Check the linked sources for full context.`,
  );
  return lines.join("\n\n") + "\n";
}

export function leaderboardMarkdown({
  stories,
  ingestion,
  observed_at = new Date().toISOString(),
}: {
  stories: CardStory[];
  ingestion: Date | null;
  observed_at?: string;
}): string {
  const readyStories = stories.filter(hasReadySummary);
  const lines = [
    "# AI on Hacker News",
    "The articles and the arguments worth reading.",
    `## Top stories (${readyStories.length})`,
    ingestion ? `Updated ${ingestion.toISOString()}` : "Waiting for stories",
  ];
  if (ingestion && Date.now() - ingestion.getTime() > 3 * 60 * 60 * 1000)
    lines.push("Updates are delayed. These are the latest saved stories.");
  if (!readyStories.length)
    lines.push("No stories yet. Stories will appear after the next update.");
  for (const story of readyStories) {
    const category = categoryById(story.category);
    lines.push(
      `### ${story.rank ?? ""}. ${link(story.title, canonicalStoryUrl(story.hn_id, story.story_slug))}`,
      `${story.points} points · ${link(`${story.comment_count} comments`, `https://news.ycombinator.com/item?id=${story.hn_id}`)}${!story.is_recent ? " · Archive" : ""}`,
    );
    lines.push(storyIndicators(story, observed_at).map(text).join("\n\n"));
    if (category)
      lines.push(
        `Category: ${link(category.label, `https://hacksnap.live${categoryURL(category)}`)}`,
      );
    const article = storySource(story.url, null).article;
    if (article) lines.push(link("Original article", article));
    lines.push(text(story.summary.overall_takeaway));
  }
  lines.push(
    "Added in the past 24 hours first · Older stories fill remaining places · Each group ranked by points · Summaries updated hourly",
  );
  return lines.join("\n\n") + "\n";
}

export function latestMarkdown({
  stories,
  page,
  hasNext,
  month = null,
}: {
  stories: CardStory[];
  page: number;
  hasNext: boolean;
  month?: string | null;
}): string {
  const readyStories = stories.filter(hasReadySummary);
  const lines = [
    month ? `# ${monthLabel(month)} stories` : "# Latest stories",
    "AI stories from Hacker News, newest first.",
    `Page ${page}`,
  ];
  if (!readyStories.length)
    lines.push("No stories yet. Stories will appear after the next update.");
  for (const story of readyStories) {
    const category = categoryById(story.category);
    lines.push(
      `## ${link(story.title, canonicalStoryUrl(story.hn_id, story.story_slug))}`,
      `Added ${text(new Date(story.date_added).toISOString())}`,
      `${story.points} points · ${link(`${story.comment_count} comments`, `https://news.ycombinator.com/item?id=${story.hn_id}`)}`,
    );
    if (category)
      lines.push(
        `Category: ${link(category.label, `https://hacksnap.live${categoryURL(category)}`)}`,
      );
    const article = storySource(story.url, null).article;
    if (article) lines.push(link("Original article", article));
    lines.push(text(story.summary.overall_takeaway));
  }
  if (page > 1)
    lines.push(link("Newer stories", `https://hacksnap.live${archiveURL(month, page - 1)}`));
  if (hasNext)
    lines.push(link("Older stories", `https://hacksnap.live${archiveURL(month, page + 1)}`));
  return lines.join("\n\n") + "\n";
}

export function markdownResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: "Accept, User-Agent",
      // Cache data behind the handler; keep negotiated representations out of shared HTTP caches.
      "Cache-Control": "no-store",
      ...(status === 503 ? { "Retry-After": "60" } : {}),
    },
  });
}

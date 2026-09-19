import type { Story } from "./data";

// Wildcards alone keep the browser default. An explicit Markdown preference
// must be acceptable and at least as preferred as HTML.
export function acceptsMarkdown(accept: string | null): boolean {
  const ranges = (accept ?? "").split(",").map(part => {
    const [type, ...params] = part.trim().toLowerCase().split(";");
    const q = params.map(p => p.trim()).find(p => p.startsWith("q="));
    const quality = q ? Number(q.slice(2)) : 1;
    return {type: type.trim(), quality: Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0};
  });
  const markdown = Math.max(0, ...ranges.filter(r => r.type === "text/markdown").map(r => r.quality));
  const htmlRange = ["text/html", "text/*", "*/*"].map(type => ranges.filter(r => r.type === type)).find(matches => matches.length);
  const html = htmlRange ? Math.max(...htmlRange.map(r => r.quality)) : 0;
  return markdown > 0 && markdown >= html;
}

function text(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/([\\`*_{}\[\]<>#+.!|~-])/g, "\\$1");
}

function link(label: string, url: string): string {
  return `[${text(label)}](<${url.replace(/[<>\s]/g, c => encodeURIComponent(c))}>)`;
}

function original(story: Story): string | null {
  try {
    const url = new URL(story.url);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        ["news.ycombinator.com", "www.news.ycombinator.com"].includes(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function storyMarkdown(story: Story): string {
  const article = original(story);
  const summary = story.summary;
  const lines = [`# ${text(story.title)}`, `${story.points} points · ${story.comment_count} comments`,
    link("Full discussion", `https://news.ycombinator.com/item?id=${story.hn_id}`)];
  if (article) lines.push(link("Read original", article));
  if (!summary) return [...lines, "## Summary pending", "Summaries update hourly. You can read the original sources above.", ""].join("\n\n");
  lines.push(text(summary.overall_takeaway), article ? "## The brief" : "## The post",
    summary.article_summary ? text(summary.article_summary) : summary.source_coverage.article_status === "unavailable"
      ? "The original article couldn’t be retrieved. This brief covers the discussion only."
      : "An HN text post. The discussion is summarized below.");
  if (summary.article_summary && summary.article_key_points.length) lines.push(summary.article_key_points.map(p => `- ${text(p)}`).join("\n"));
  lines.push("## In the discussion", text(summary.discussion_summary));
  for (const point of summary.discussion_points) {
    lines.push(`### ${text(point.title)}`, text(point.summary));
    if (point.comment_ids.length) lines.push("Sources: " + point.comment_ids.map(id => link(`Comment ${id}`, `https://news.ycombinator.com/item?id=${id}`)).join(" · "));
  }
  const coverage = summary.source_coverage;
  lines.push("## Sources & coverage", `AI-generated summary · ${text(summary.generated_at)}`,
    `Based on ${coverage.included_comments} of ${coverage.stored_comments} usable stored comments, selected by depth and branch activity. This is a sample of the discussion.${coverage.comments_truncated ? " The model input was further shortened to fit its context limit." : ""} Article text may also be shortened.`,
    `Generated using ${text(summary.model)}. Check the linked sources for full context.`);
  return lines.join("\n\n") + "\n";
}

export function leaderboardMarkdown({stories, ingestion}: {stories: Story[]; ingestion: Date | null}): string {
  const lines = ["# AI on Hacker News", "The articles and the arguments worth reading.", `## Top stories (${stories.length})`,
    ingestion ? `Updated ${ingestion.toISOString()}` : "Waiting for stories"];
  if (ingestion && Date.now() - ingestion.getTime() > 3 * 60 * 60 * 1000) lines.push("Updates are delayed. These are the latest saved stories.");
  if (!stories.length) lines.push("No stories yet. Stories will appear after the next update.");
  for (const story of stories) {
    lines.push(`### ${story.rank ?? ""}. ${link(story.title, `https://hacksnap.live/story/${story.hn_id}`)}`,
      `${story.points} points · ${link(`${story.comment_count} comments`, `https://news.ycombinator.com/item?id=${story.hn_id}`)}${!story.is_recent ? " · Archive" : ""}`);
    const article = original(story);
    if (article) lines.push(link("Original article", article));
    lines.push(story.summary ? text(story.summary.overall_takeaway) : "Summary pending");
  }
  lines.push("Added in the past 24 hours first · Older stories fill remaining places · Each group ranked by points · Summaries updated hourly");
  return lines.join("\n\n") + "\n";
}

export function markdownResponse(body: string, status = 200): Response {
  return new Response(body, {status, headers: {
    "Content-Type": "text/markdown; charset=utf-8",
    "Vary": "Accept",
    // The underlying leaderboard already has its own shared data cache.
    "Cache-Control": "no-store",
    ...(status === 503 ? {"Retry-After": "60"} : {}),
  }});
}

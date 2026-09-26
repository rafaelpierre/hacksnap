import Link from "next/link";
import { ArrowUp, MessageCircle } from "lucide-react";
import type { Story } from "../lib/data";
import { articleURL, domain } from "../lib/format";
import { CategoryBadge } from "./categories";
import { LocalTime } from "./local-time";
import { ShareLinks } from "./share-links";

export function StoryRow({story, variant = "unranked"}: {story: Story; variant?: "ranked" | "unranked"}) {
  const source = articleURL(story.url);
  const rank = variant === "ranked" ? Number(story.rank) : null;
  const hasRank = rank !== null && Number.isInteger(rank) && rank > 0;
  const takeaway = story.summary?.overall_takeaway?.trim();

  return <article className={`story-row feed-story ${hasRank ? "feed-story-ranked" : "feed-story-unranked"}${rank === 1 ? " feed-story-lead" : ""}`}>
    {hasRank && <span className="rank" aria-label={`Rank ${rank}`}>{String(rank).padStart(2, "0")}</span>}
    <div className="story-content">
      <div className="story-domain">
        {source ? <a href={source} aria-label={`Original article on ${domain(story.url)}`}>{domain(story.url)} <span aria-hidden="true">↗</span></a> :
          <a href={`https://news.ycombinator.com/item?id=${story.hn_id}`}>Hacker News <span aria-hidden="true">↗</span></a>}
        {variant === "ranked" && story.is_recent === false && <span className="archive-label">Archive</span>}
      </div>
      <h3><Link href={`/story/${story.hn_id}`}>{story.title}</Link></h3>
      {takeaway ? <p className="feed-excerpt">{takeaway}</p> : <p className="feed-excerpt feed-pending">Brief pending. Check back after the next summary update.</p>}
      <div className="feed-story-footer">
        <div className="story-meta">
          {story.category && <CategoryBadge id={story.category} />}
          <span className="points"><ArrowUp size={14} aria-hidden="true" />{story.points.toLocaleString("en-GB")} points</span>
          <a href={`https://news.ycombinator.com/item?id=${story.hn_id}`}><MessageCircle size={14} aria-hidden="true" />{story.comment_count.toLocaleString("en-GB")} comments <span aria-hidden="true">↗</span></a>
          <span>Added <LocalTime dateTime={story.date_added.toISOString()} /></span>
        </div>
        <ShareLinks id={story.hn_id} title={story.title} takeaway={takeaway} />
      </div>
    </div>
  </article>;
}

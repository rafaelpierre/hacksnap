import Link from "next/link";
import { getLeaderboard } from "../lib/data";
import { articleURL, domain, timestamp } from "../lib/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const {stories, ingestion} = await getLeaderboard();
  const stale = ingestion && Date.now() - ingestion.getTime() > 3 * 60 * 60 * 1000;
  return <>
    <section className="hero">
      <div className="eyebrow"><span className="signal-dot" /> THE AI EDITION</div>
      <h1>Less noise.<br/><span>More perspective.</span></h1>
      <p>The AI stories rising on Hacker News.<br/>What the article says. What the comments get into.</p>
      <div className="hero-caption"><span>01—10 / RANKED BY POINTS</span><span>LAST 24 HOURS, WITH ARCHIVE PICKS</span></div>
    </section>
    <section aria-labelledby="leaderboard-heading">
      <div className="section-bar"><h2 id="leaderboard-heading">On the radar <span>{String(stories.length).padStart(2, "0")}</span></h2>
        <p>{ingestion ? <>Ingested <time dateTime={ingestion.toISOString()}>{timestamp(ingestion)}</time></> : "Awaiting first ingestion"}</p>
      </div>
      {stale && <p className="notice">The last ingestion is over three hours old. Existing stories remain on the radar while we wait for the next update.</p>}
      {stories.length === 0 ? <div className="empty"><span className="eyebrow">A QUIET WINDOW</span><h3>No eligible stories yet.</h3><p>The first successfully ingested AI stories will appear here.</p></div> :
      <div className="story-grid">{stories.map(story => <article className="story-card" key={story.hn_id}>
        <div className="card-kicker"><span className="rank">{String(story.rank).padStart(2, "0")}</span><span>{domain(story.url)}</span>{!story.is_recent && <span className="archive-label">ARCHIVE</span>}<span className="card-arrow" aria-hidden="true">↗</span></div>
        <h3><Link className="story-link" href={`/story/${story.hn_id}`}>{story.title}</Link></h3>
        <p className={`takeaway ${story.summary ? "" : "pending"}`}>{story.summary?.overall_takeaway ?? "Summary on the way. Open the story for its original sources."}</p>
        <div className="card-bottom"><div className="metrics"><span className="points">▲ {story.points.toLocaleString("en-GB")} points</span><span>{story.comment_count.toLocaleString("en-GB")} comments</span></div>
          <div className="card-footer"><span>{story.summary ? <>Summarized <time dateTime={story.summary.generated_at}>{timestamp(story.summary.generated_at)}</time></> : "Awaiting hourly summary"}</span>
          <div className="outbound">{articleURL(story.url) && <a href={articleURL(story.url)!} aria-label={`Original article: ${story.title}`}>Article ↗</a>}
            <a href={`https://news.ycombinator.com/item?id=${story.hn_id}`} aria-label={`HN discussion: ${story.title}`}>HN ↗</a></div></div>
        </div>
      </article>)}</div>}
      <p className="method-note">Top stories added in the last 24 hours, filled to 10 with older stories when needed · Points descending · Summaries refresh hourly</p>
    </section>
  </>;
}

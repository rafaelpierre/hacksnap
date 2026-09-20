import Link from "next/link";
import { connection } from "next/server";
import { getLeaderboard } from "../lib/data";
import { articleURL, domain, timestamp } from "../lib/format";
import { RankSparkline } from "./rank-sparkline";

export default async function Home() {
  // Render timestamps per request without disabling the shared data cache or
  // requiring a database connection during the production build.
  await connection();
  const {stories, ingestion} = await getLeaderboard();
  const maxRank = Math.max(10, ...stories.flatMap(story => story.rank_history.map(point => point.rank)));
  const stale = ingestion && Date.now() - ingestion.getTime() > 3 * 60 * 60 * 1000;
  return <>
    <header className="feed-header">
      <div className="channel-path">hacksnap / <span>ai</span></div>
      <h1>AI on Hacker News</h1>
      <p>The articles and the arguments worth reading.</p>
    </header>
    <section aria-labelledby="feed-heading">
      <div className="feed-bar"><h2 id="feed-heading">Top stories <span>{stories.length}</span></h2>
        <p>{ingestion ? <>Updated <time dateTime={ingestion.toISOString()}>{timestamp(ingestion)}</time></> : "Waiting for stories"}</p>
      </div>
      {stale && <p className="notice">Updates are delayed. These are the latest saved stories.</p>}
      {stories.length === 0 ? <div className="empty"><h2>No stories yet.</h2><p>Stories will appear after the next update.</p></div> :
      <ol className="story-list">{stories.map(story => <li key={story.hn_id}>
        <article className="story-row">
          <span className="rank" aria-label={`Rank ${story.rank}`}>{String(story.rank).padStart(2, "0")}</span>
          <div className="story-content">
            <div className="story-domain">{articleURL(story.url) ? <a href={articleURL(story.url)!} aria-label={`Original article: ${story.title}`}>{domain(story.url)} <span aria-hidden="true">↗</span></a> : <span>Ask / Show HN</span>}{!story.is_recent && <span className="archive-label">Archive</span>}</div>
            <h3><Link href={`/story/${story.hn_id}`}>{story.title}</Link></h3>
            {story.summary && <p className="feed-excerpt">{story.summary.overall_takeaway}</p>}
            <div className="story-meta"><span className="points">{story.points.toLocaleString("en-GB")} points</span><a href={`https://news.ycombinator.com/item?id=${story.hn_id}`}>{story.comment_count.toLocaleString("en-GB")} comments <span aria-hidden="true">↗</span></a>{!story.summary && <span>Summary pending</span>}</div>
          </div>
          <RankSparkline history={story.rank_history} title={story.title} maxRank={maxRank} />
        </article>
      </li>)}</ol>}
      <p className="method-note">Added in the past 24 hours first · Older stories fill remaining places · Each group ranked by points · Summaries updated hourly</p>
    </section>
  </>;
}

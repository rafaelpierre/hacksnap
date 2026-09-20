import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeaderboard } from "../../lib/data";
import { articleURL, domain, timestamp } from "../../lib/format";
import { Sentiment } from "../sentiment";
import { ActivitySparkline } from "../activity-sparkline";

export const revalidate = 1800;

// An optional segment lets / use on-demand ISR without querying data at build time.
export async function generateStaticParams() {
  return [];
}

export default async function Home({params}: {params: Promise<{path?: string[]}>}) {
  // Only the root URL belongs to this page; unknown paths must remain 404s.
  if ((await params).path?.length) notFound();
  const {stories, ingestion, observed_at} = await getLeaderboard();
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
          <span className="rank" data-rank={story.rank} aria-label={`Rank ${story.rank}`}>{String(story.rank).padStart(2, "0")}</span>
          <div className="story-content">
            <div className="story-domain">{articleURL(story.url) ? <a href={articleURL(story.url)!} aria-label={`Original article: ${story.title}`}>{domain(story.url)} <span aria-hidden="true">↗</span></a> : <span>Ask / Show HN</span>}{!story.is_recent && <span className="archive-label">Archive</span>}</div>
            <h3><Link href={`/story/${story.hn_id}`}>{story.title}</Link></h3>
            {story.summary && <p className="feed-excerpt">{story.summary.overall_takeaway}</p>}
            <div className="story-meta"><span className="points">{story.points.toLocaleString("en-GB")} points</span><a href={`https://news.ycombinator.com/item?id=${story.hn_id}`}>{story.comment_count.toLocaleString("en-GB")} comments <span aria-hidden="true">↗</span></a>{!story.summary && <span>Summary pending</span>}</div>
          </div>
          <div className="story-indicators">
          <Sentiment value={story.summary?.sentiment ?? null} noComments={story.summary?.source_coverage.included_comments === 0} />
          <ActivitySparkline history={story.activity_history} title={story.title} asOf={observed_at} />
          </div>
        </article>
      </li>)}</ol>}
      <p className="method-note">Added in the past 24 hours first · Older stories fill remaining places · Each group ranked by points · Sparklines show points/hour over the past 24h, scaled per story · Sentiment estimates sampled comments: −1 Skeptical, 0 Neutral, +1 Excited · Summaries updated hourly</p>
    </section>
  </>;
}

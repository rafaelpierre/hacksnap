import Link from "next/link";
import { notFound } from "next/navigation";
import { getLeaderboard } from "../../lib/data";
import { LocalTime } from "../local-time";
import { StoryRow } from "../story-row";
import { BrowseLayout } from "../topic-sidebar";
import { ListPositionRestorer } from "../story-navigation";

export const revalidate = 1800;

// An optional segment lets / use on-demand ISR without querying data at build time.
export async function generateStaticParams() {
  return [];
}

export default async function Home({params}: {params: Promise<{path?: string[]}>}) {
  // Only the root URL belongs to this page; unknown paths must remain 404s.
  if ((await params).path?.length) notFound();
  const {stories, ingestion} = await getLeaderboard();
  const stale = ingestion && Date.now() - ingestion.getTime() > 3 * 60 * 60 * 1000;
  return <BrowseLayout>
    <ListPositionRestorer />
    <header className="feed-header">
      <div className="channel-path">hacksnap / <span>top stories</span></div>
      <h1>Top AI stories on Hacker News</h1>
      <p>AI stories and highlights from Hacker News discussions.</p>
    </header>
    <section aria-labelledby="feed-heading">
      <div className="feed-bar"><h2 id="feed-heading">Top stories <span>{stories.length}</span></h2>
        <p>{ingestion ? <>Updated <LocalTime dateTime={ingestion.toISOString()} /></> : "Waiting for stories"}</p>
      </div>
      {stale && <p className="notice">Updates are delayed. These are the latest saved stories.</p>}
      {stories.length === 0 ? <div className="empty"><h2>No stories yet.</h2><p>Stories will appear after the next update.</p></div> :
      <ol className="story-list">{stories.map(story => <li key={story.hn_id}><StoryRow story={story} variant="ranked" /></li>)}</ol>}
      <p className="archive-cta"><Link className="button" href="/archive">Browse latest stories →</Link></p>
      <p className="method-note">Added in the past 24 hours first · Older stories fill remaining places · Each group ranked by points · Summaries updated hourly</p>
    </section>
  </BrowseLayout>;
}

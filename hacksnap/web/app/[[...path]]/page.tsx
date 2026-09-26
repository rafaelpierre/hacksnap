import { ChevronRight } from "lucide-react";
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
  return <BrowseLayout active="home">
    <ListPositionRestorer />
    <header className="feed-header home-intro">
      <h1>AI news for people who build.</h1>
      <p>AI stories and highlights from Hacker News discussions.</p>
    </header>
    <section aria-label="Top stories">
      <div className="feed-bar">
        <p>{ingestion ? <>Updated <LocalTime dateTime={ingestion.toISOString()} /></> : "Waiting for stories"}</p>
      </div>
      {stale && <p className="notice">Updates are delayed. These are the latest saved stories.</p>}
      {stories.length === 0 ? <div className="empty"><h2>No stories yet.</h2><p>Stories will appear after the next update.</p></div> :
      <ol className="story-list">{stories.map(story => <li key={story.hn_id}><StoryRow story={story} variant="ranked" /></li>)}</ol>}
      <p className="archive-cta"><Link className="browse-latest-link" href="/archive">Browse latest stories <ChevronRight className="inline-icon" aria-hidden="true" /></Link></p>
    </section>
  </BrowseLayout>;
}

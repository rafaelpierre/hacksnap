import { withDataFallback } from "../with-data-fallback";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getReadyStoryPage } from "../../lib/data";
import { ReadyStoryPageError } from "../../lib/ready-story-pagination";
import { publicFeedStory } from "../../lib/stories-api";
import { BrowseLayout } from "../topic-sidebar";
import { StoryFeed } from "../story-feed";

export const dynamic = "force-dynamic";

async function Home({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<{ page?: string | string[]; cursor?: string | string[] }>;
}) {
  // Only the root URL belongs to this page; unknown paths must remain 404s.
  if ((await params).path?.length) notFound();
  const query = await searchParams;
  const rawPage = query.page;
  const rawCursor = query.cursor;
  if (Array.isArray(rawPage) || Array.isArray(rawCursor)) notFound();
  if (rawPage && (!/^[1-9][0-9]*$/.test(rawPage) || Number(rawPage) > 10000)) notFound();
  let result;
  try {
    result = await getReadyStoryPage({
      page: rawPage ? Number(rawPage) : undefined,
      cursor: rawCursor,
    });
  } catch (error) {
    if (error instanceof ReadyStoryPageError) {
      if (error.status === 400) notFound();
      return (
        <BrowseLayout active="home">
          <div className="empty home-feed-expired">
            <h1>This story selection has expired.</h1>
            <p>Start a fresh selection to see the current stories.</p>
            <a className="button" href="/">
              Start fresh
            </a>
          </div>
        </BrowseLayout>
      );
    }
    throw error;
  }
  const { stories, ingestion, pagination } = result;
  const stale = ingestion && Date.now() - ingestion.getTime() > 3 * 60 * 60 * 1000;
  return (
    <BrowseLayout active="home">
      <header className="feed-header home-intro">
        <h1>AI news for people who build.</h1>
        <p>AI stories and highlights from Hacker News discussions.</p>
      </header>
      <section aria-label="Top stories">
        {stale && (
          <p className="notice">Updates are delayed. These are the latest saved stories.</p>
        )}
        <StoryFeed
          key={`${pagination.page}:${rawCursor ?? "fresh"}`}
          initialStories={stories.map(publicFeedStory)}
          initialPagination={pagination}
        />
        <p className="archive-cta">
          <Link className="browse-latest-link" href="/archive">
            Browse latest stories <ChevronRight className="inline-icon" aria-hidden="true" />
          </Link>
        </p>
      </section>
    </BrowseLayout>
  );
}

export default withDataFallback(Home);

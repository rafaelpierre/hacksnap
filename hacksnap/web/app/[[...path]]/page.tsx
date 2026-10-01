import { withDataFallback } from "../with-data-fallback";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { getReadyStoryPage } from "../../lib/data";
import { shouldStreamBrowse } from "../../lib/browse-streaming";
import { ReadyStoryPageError } from "../../lib/ready-story-pagination";
import { publicFeedStory } from "../../lib/stories-api";
import { BrowseLayout } from "../topic-sidebar";
import { StoryFeed } from "../story-feed";
import { BrowseLoading } from "../browse-loading";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<{ page?: string | string[]; cursor?: string | string[] }>;
};

function HomeShell({ children }: { children: ReactNode }) {
  return (
    <BrowseLayout active="home">
      <header className="feed-header home-intro">
        <h1>AI news for people who build.</h1>
        <p>AI stories and highlights from Hacker News discussions.</p>
      </header>
      <section aria-label="Top stories">{children}</section>
    </BrowseLayout>
  );
}

const HomeStories = withDataFallback(async function HomeStories({
  rawPage,
  rawCursor,
}: {
  rawPage?: string;
  rawCursor?: string;
}) {
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
    <HomeShell>
      {stale && <p className="notice">Updates are delayed. These are the latest saved stories.</p>}
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
    </HomeShell>
  );
});

async function Home({ params, searchParams }: Props) {
  // Only the root URL belongs to this page; unknown paths must remain 404s.
  if ((await params).path?.length) notFound();
  const { page: rawPage, cursor: rawCursor } = await searchParams;
  if (Array.isArray(rawPage) || Array.isArray(rawCursor)) notFound();
  if (rawPage && (!/^[1-9][0-9]*$/.test(rawPage) || Number(rawPage) > 10000)) notFound();

  // Query pages can fail cursor validation; document requests must remain useful without JS.
  if (rawPage !== undefined || rawCursor !== undefined || !(await shouldStreamBrowse()))
    return HomeStories({ rawPage, rawCursor });
  return (
    <Suspense
      fallback={
        <HomeShell>
          <BrowseLoading />
        </HomeShell>
      }
    >
      <HomeStories />
    </Suspense>
  );
}

export default withDataFallback(Home);

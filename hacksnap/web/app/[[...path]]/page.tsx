import { withDataFallback } from "../with-data-fallback";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { getArchiveMonths, getArchiveStories } from "../../lib/data";
import { archiveMonth, archivePage, archiveURL, monthLabel } from "../../lib/archive";
import { Suspense, type ReactNode } from "react";
import { ArchiveStoryList } from "../archive-story-list";
import { BrowseLoading } from "../browse-loading";
import { shouldStreamBrowse } from "../../lib/browse-streaming";
import { BrowseLayout } from "../topic-sidebar";
import { PopularStories, PopularStoriesLoading } from "../popular-stories";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<{ page?: string | string[]; cursor?: string | string[] }>;
};

async function selection({ params, searchParams }: Props) {
  const { path = [] } = await params;
  const month = path.length ? archiveMonth(path) : null;
  if (path.length && !month) notFound();
  const page = archivePage((await searchParams).page);
  if (page === null) notFound();
  return { month, page };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { month, page } = await selection(props);
  const homepage = month === null && page === 1;
  const legacyCursor = (await props.searchParams).cursor !== undefined;
  const title = homepage
    ? "Hacksnap | AI News"
    : `${month ? monthLabel(month) + " archive" : "Latest stories"}${page > 1 ? ` — Page ${page}` : ""}`;
  const description = month
    ? "Browse past Hacker News stories and discussion summaries by the date they were added to Hacksnap."
    : "AI stories from Hacker News, newest first, with article briefs and highlights from the discussion.";
  const canonical = archiveURL(month, page);
  return {
    title: homepage ? { absolute: title } : title,
    description,
    robots: { index: !legacyCursor, follow: true },
    ...(legacyCursor
      ? {}
      : {
          alternates: {
            canonical,
            types: { "application/rss+xml": "https://hacksnap.live/feed.xml" },
          },
        }),
    openGraph: { title, description, url: canonical },
    twitter: { title, description },
  };
}

async function LatestContent({ content }: { content: Promise<ReactNode> }) {
  return await content;
}

async function Latest(props: Props) {
  const { month, page } = await selection(props);
  // Frozen ranked selections are obsolete; keep their public page destination.
  if ((await props.searchParams).cursor !== undefined) permanentRedirect(archiveURL(month, page));
  if (month) {
    const months = await getArchiveMonths();
    if (!months.some((item) => item.month === month)) notFound();
  }
  // Later pages must establish existence before any loading UI flushes a 200.
  const result =
    page > 1 || !(await shouldStreamBrowse()) ? await getArchiveStories(month, page) : undefined;
  if (page > 1 && result && result.stories.length === 0) notFound();
  // Start required story data before optional popularity can occupy the reader pool.
  const pendingContent = result ? undefined : ArchiveStoryList({ month, page });
  const content = result ? (
    await ArchiveStoryList({ month, page, result })
  ) : (
    <Suspense key={`${archiveURL(month)}:${page}`} fallback={<BrowseLoading />}>
      <LatestContent content={pendingContent!} />
    </Suspense>
  );
  return (
    <BrowseLayout
      active={month ? undefined : "home"}
      rightSidebar={
        month ? undefined : (
          <Suspense fallback={<PopularStoriesLoading />}>
            <PopularStories />
          </Suspense>
        )
      }
    >
      {month ? (
        <header className="feed-header archive-month-header">
          <div className="channel-path">
            <Link href="/">latest</Link> / <span>{monthLabel(month)}</span>
          </div>
          <h1>{monthLabel(month)}</h1>
        </header>
      ) : (
        <h1 className="sr-only">Latest stories</h1>
      )}
      <section aria-label="Latest stories">{content}</section>
    </BrowseLayout>
  );
}

export default withDataFallback(Latest);

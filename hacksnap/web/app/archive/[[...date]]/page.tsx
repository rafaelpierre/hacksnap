import { withDataFallback } from "../../with-data-fallback";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getArchiveMonths, getArchiveStories } from "../../../lib/data";
import { archiveMonth, archivePage, archiveURL, monthLabel } from "../../../lib/archive";
import { Suspense } from "react";
import { ArchiveStoryList } from "../../archive-story-list";
import { BrowseLoading } from "../../browse-loading";
import { shouldStreamBrowse } from "../../../lib/browse-streaming";
import { BrowseLayout } from "../../topic-sidebar";

type Props = {
  params: Promise<{ date?: string[] }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

async function selection({ params, searchParams }: Props) {
  const { date = [] } = await params;
  const month = date.length ? archiveMonth(date) : null;
  const page = archivePage((await searchParams).page);
  if ((date.length && !month) || page === null) notFound();
  return { month, page };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { month, page } = await selection(props);
  return {
    title: `${month ? monthLabel(month) + " archive" : "Latest stories"}${page > 1 ? ` — Page ${page}` : ""}`,
    description:
      "Browse past Hacker News stories and discussion summaries by the date they were added to Hacksnap.",
    alternates: { canonical: archiveURL(month, page) },
  };
}

async function Archive(props: Props) {
  const { month, page } = await selection(props);
  if (month) {
    const months = await getArchiveMonths();
    if (!months.some((item) => item.month === month)) notFound();
  }
  // Later pages must establish existence before any loading UI flushes a 200.
  const result =
    page > 1 || !(await shouldStreamBrowse()) ? await getArchiveStories(month, page) : undefined;
  if (page > 1 && result && result.stories.length === 0) notFound();
  const content = result ? (
    await ArchiveStoryList({ month, page, result })
  ) : (
    <Suspense key={`${archiveURL(month)}:${page}`} fallback={<BrowseLoading />}>
      <ArchiveStoryList month={month} page={page} />
    </Suspense>
  );
  return (
    <BrowseLayout>
      <header className="feed-header">
        <div className="channel-path">
          <Link href="/">hacksnap</Link> /{" "}
          {month ? (
            <>
              <Link href="/archive">latest</Link> / <span>{monthLabel(month)}</span>
            </>
          ) : (
            <span>latest</span>
          )}
        </div>
        <h1>{month ? monthLabel(month) : "Latest stories"}</h1>
        <p>AI stories from Hacker News, newest first.</p>
      </header>
      {content}
    </BrowseLayout>
  );
}

export default withDataFallback(Archive);

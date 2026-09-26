import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getArchiveMonths, getArchiveStories, type Story } from "../../../lib/data";
import { archiveMonth, archivePage, archiveURL, monthLabel } from "../../../lib/archive";
import { StoryRow } from "../../story-row";
import { BrowseLayout } from "../../topic-sidebar";
import { ListPositionRestorer } from "../../story-navigation";

type Props = {params: Promise<{date?: string[]}>; searchParams: Promise<{page?: string | string[]}>};

async function selection({params, searchParams}: Props) {
  const {date = []} = await params;
  const month = date.length ? archiveMonth(date) : null;
  const page = archivePage((await searchParams).page);
  if ((date.length && !month) || page === null) notFound();
  return {month, page};
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const {month, page} = await selection(props);
  return {
    title: `${month ? monthLabel(month) + " archive" : "Latest stories"}${page > 1 ? ` — Page ${page}` : ""}`,
    description: "Browse past Hacker News stories and discussion summaries by the date they were added to Hacksnap.",
    alternates: {canonical: archiveURL(month, page)},
  };
}

export default async function Archive(props: Props) {
  const {month, page} = await selection(props);
  const months = await getArchiveMonths();
  if (month && !months.some(item => item.month === month)) notFound();
  const {stories, hasNext} = await getArchiveStories(month, page);
  if (page > 1 && stories.length === 0) notFound();
  const groups = new Map<string, Story[]>();
  for (const story of stories) {
    const day = story.date_added.toISOString().slice(0, 10);
    groups.set(day, [...(groups.get(day) ?? []), story]);
  }
  const years = [...new Set(months.map(item => item.month.slice(0, 4)))];
  return <BrowseLayout>
    <ListPositionRestorer />
    <header className="feed-header">
      <div className="channel-path"><Link href="/">hacksnap</Link> / {month ? <><Link href="/archive">latest</Link> / <span>{monthLabel(month)}</span></> : <span>latest</span>}</div>
      <h1>{month ? monthLabel(month) : "Latest stories"}</h1>
      <p>AI stories from Hacker News, newest first. Browse by month below.</p>
    </header>
    <nav className="archive-months" aria-label="Browse archive by month">
      <Link className="button" href="/archive" aria-current={!month ? "page" : undefined}>All stories</Link>
      {years.length > 0 && <details className="archive-date-control" open={Boolean(month)}>
        <summary>Browse by month</summary>
        {years.map(year => <details key={year} open={year === month?.slice(0, 4)}>
          <summary>{year}</summary>
          <ul>{months.filter(item => item.month.startsWith(year)).map(item => <li key={item.month}>
            <Link href={archiveURL(item.month)} aria-current={month === item.month ? "page" : undefined}>
              {monthLabel(item.month).replace(` ${year}`, "")} <span>({item.count})</span>
            </Link>
          </li>)}</ul>
        </details>)}
      </details>}
    </nav>
    {stories.length === 0 ? <div className="empty"><h2>No stories yet.</h2><p>Stories will appear here after the next update.</p></div> :
      [...groups].map(([day, items]) => <section key={day} aria-labelledby={`day-${day}`}>
        <div className="feed-bar"><h2 id={`day-${day}`}><time dateTime={day}>{new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {day: "numeric", month: "long", year: "numeric", timeZone: "UTC"})}</time></h2></div>
        <ul className="story-list">{items.map(story => <li key={story.hn_id}><StoryRow story={story} /></li>)}</ul>
      </section>)}
    {stories.length > 0 && <nav className="archive-pagination" aria-label="Archive pages">
      {page > 1 && <Link className="button" href={archiveURL(month, page - 1)}>← Newer stories</Link>}
      <span>Page {page}</span>
      {hasNext && <Link className="button" href={archiveURL(month, page + 1)}>Older stories →</Link>}
    </nav>}
  </BrowseLayout>;
}

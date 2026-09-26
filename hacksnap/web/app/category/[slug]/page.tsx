import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCategoryCounts, getCategoryStories } from "../../../lib/data";
import { categoryBySlug, categoryURL } from "../../../lib/categories";
import { archivePage } from "../../../lib/archive";
import { articleURL, domain } from "../../../lib/format";
import { CategoryBadge } from "../../categories";
import { LocalTime } from "../../local-time";
import { SummaryPending } from "../../summary-pending";
import { BrowseLayout } from "../../topic-sidebar";

type Props = {params: Promise<{slug: string}>; searchParams: Promise<{page?: string | string[]}>};

async function selection({params, searchParams}: Props) {
  const category = categoryBySlug((await params).slug);
  const page = archivePage((await searchParams).page);
  if (!category || page === null) notFound();
  return {category, page};
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const {category, page} = await selection(props);
  const title = `${category.label}${page > 1 ? ` — Page ${page}` : ""}`;
  return {title, description: category.description, alternates: {canonical: categoryURL(category, page)},
    openGraph: {title: `${title} | Hacksnap`, description: category.description, url: categoryURL(category, page)}};
}

export default async function CategoryPage(props: Props) {
  const {category, page} = await selection(props);
  const [counts, {stories, hasNext}] = await Promise.all([getCategoryCounts(), getCategoryStories(category.id, page)]);
  if (page > 1 && !stories.length) notFound();
  return <BrowseLayout active={category.id}>
    <header className="feed-header category-header" data-color={category.color}>
      <div className="channel-path"><Link href="/">hacksnap</Link> / <Link href="/topics">topics</Link> / <span>{category.label}</span></div>
      <h1><span className="category-dot" aria-hidden="true" />{category.label}</h1>
      <p>{category.description}</p>
    </header>
    <section aria-labelledby="category-stories-heading">
      <div className="feed-bar"><h2 id="category-stories-heading">Latest stories <span>{counts[category.id] ?? 0}</span></h2><p>Newest first</p></div>
      {!stories.length ? <div className="empty"><h2>No stories in this topic yet.</h2><p>New stories will appear here as they’re added.</p><Link className="button" href="/">Browse top stories →</Link></div> :
        <ul className="story-list">{stories.map(story => <li key={story.hn_id}>
          <article className="story-row archive-story">
            <div className="story-content">
              <div className="story-domain">{articleURL(story.url) ? <a href={articleURL(story.url)!} aria-label={`Original article: ${story.title}`}>{domain(story.url)} ↗</a> : <span>Ask / Show HN</span>}</div>
              <h3><Link href={`/story/${story.hn_id}`}>{story.title}</Link>{!story.summary && <SummaryPending />}</h3>
              {story.category && <div className="story-flair"><CategoryBadge id={story.category} /></div>}
              {story.summary && <p className="feed-excerpt">{story.summary.overall_takeaway}</p>}
              <div className="story-meta"><span className="points">{story.points.toLocaleString("en-GB")} points</span><a href={`https://news.ycombinator.com/item?id=${story.hn_id}`}>{story.comment_count.toLocaleString("en-GB")} comments ↗</a><span>Added <LocalTime dateTime={story.date_added.toISOString()} /></span></div>
            </div>
          </article>
        </li>)}</ul>}
      {!!stories.length && <nav className="archive-pagination" aria-label="Category pages">
        {page > 1 && <Link className="button" href={categoryURL(category, page - 1)}>← Newer stories</Link>}
        <span>Page {page}</span>
        {hasNext && <Link className="button" href={categoryURL(category, page + 1)}>Older stories →</Link>}
      </nav>}
    </section>
  </BrowseLayout>;
}

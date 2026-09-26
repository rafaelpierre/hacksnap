import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCategoryCounts, getCategoryStories } from "../../../lib/data";
import { categoryBySlug, categoryURL } from "../../../lib/categories";
import { archivePage } from "../../../lib/archive";
import { StoryRow } from "../../story-row";
import { BrowseLayout } from "../../topic-sidebar";
import { ListPositionRestorer } from "../../story-navigation";

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
    <ListPositionRestorer />
    <header className="feed-header category-header" data-color={category.color}>
      <div className="channel-path"><Link href="/">hacksnap</Link> / <Link href="/topics">topics</Link> / <span>{category.label}</span></div>
      <h1><span className="category-dot" aria-hidden="true" />{category.label}</h1>
      <p>{category.description}</p>
    </header>
    <section aria-labelledby="category-stories-heading">
      <div className="feed-bar"><h2 id="category-stories-heading">Latest stories <span>{counts[category.id] ?? 0}</span></h2><p>Newest first</p></div>
      {!stories.length ? <div className="empty"><h2>No stories in this topic yet.</h2><p>New stories will appear here as they’re added.</p><Link className="button" href="/">Browse top stories →</Link></div> :
        <ul className="story-list">{stories.map(story => <li key={story.hn_id}><StoryRow story={story} /></li>)}</ul>}
      {!!stories.length && <nav className="archive-pagination" aria-label="Category pages">
        {page > 1 && <Link className="button" href={categoryURL(category, page - 1)}>← Newer stories</Link>}
        <span>Page {page}</span>
        {hasNext && <Link className="button" href={categoryURL(category, page + 1)}>Older stories →</Link>}
      </nav>}
    </section>
  </BrowseLayout>;
}

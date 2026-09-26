import Link from "next/link";
import { CATEGORIES, categoryURL, type CategoryId } from "../lib/categories";

export function TopicSidebar({active}: {active?: CategoryId}) {
  return <aside className="topic-sidebar" aria-labelledby="topic-sidebar-heading">
    <h2 id="topic-sidebar-heading"><Link href="/topics">Explore topics</Link></h2>
    <nav aria-label="Topics"><ul>
      <li><Link href="/" aria-current={!active ? "page" : undefined}>All stories <span aria-hidden="true">→</span></Link></li>
      {CATEGORIES.map(category => <li key={category.id}>
        <Link href={categoryURL(category)} data-color={category.color}
          aria-current={active === category.id ? "page" : undefined}>
          {category.label}<span aria-hidden="true">→</span>
        </Link>
      </li>)}
    </ul></nav>
    <div className="topic-sidebar-about"><h3><Link href="/about">About Hacksnap</Link></h3><p>Summaries of AI stories and discussions from Hacker News, with links to the original sources.</p></div>
  </aside>;
}

export function BrowseLayout({children, active}: {children: React.ReactNode; active?: CategoryId}) {
  return <div className="browse-layout"><div className="browse-content">{children}</div><TopicSidebar active={active} /></div>;
}

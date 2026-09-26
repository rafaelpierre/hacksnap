import Link from "next/link";
import { CATEGORIES, categoryURL, type CategoryId } from "../lib/categories";

export function TopicSidebar({active}: {active?: CategoryId}) {
  return <aside className="topic-sidebar" aria-labelledby="topic-sidebar-heading">
    <h2 id="topic-sidebar-heading"><Link href="/topics">Explore topics</Link></h2>
    <nav aria-label="Topics"><ul>
      {CATEGORIES.map(category => <li key={category.id}>
        <Link href={categoryURL(category)} data-color={category.color}
          aria-current={active === category.id ? "page" : undefined}>
          <span className="category-dot" aria-hidden="true" />{category.label}
        </Link>
      </li>)}
    </ul></nav>
  </aside>;
}

export function BrowseLayout({children, active}: {children: React.ReactNode; active?: CategoryId}) {
  return <div className="browse-layout"><div className="browse-content">{children}</div><TopicSidebar active={active} /></div>;
}

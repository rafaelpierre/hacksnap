import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { CATEGORIES, categoryURL, type CategoryId } from "../lib/categories";

export function TopicSidebar({active}: {active?: CategoryId | "home"}) {
  return <aside className="topic-sidebar" aria-labelledby="topic-sidebar-heading">
    <h2 id="topic-sidebar-heading"><Link href="/topics">Explore topics</Link></h2>
    <nav aria-label="Topics"><ul>
      <li><Link href="/" aria-current={active === "home" ? "page" : undefined}>All stories <ChevronRight className="inline-icon" aria-hidden="true" /></Link></li>
      {CATEGORIES.map(category => <li key={category.id}>
        <Link href={categoryURL(category)} data-color={category.color}
          aria-current={active === category.id ? "page" : undefined}>
          {category.label}<ChevronRight className="inline-icon" aria-hidden="true" />
        </Link>
      </li>)}
    </ul></nav>
  </aside>;
}

export function BrowseLayout({children, active}: {children: React.ReactNode; active?: CategoryId | "home"}) {
  return <div className="browse-layout"><div className="browse-content">{children}</div><TopicSidebar active={active} /></div>;
}

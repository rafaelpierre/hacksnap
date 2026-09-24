import Link from "next/link";
import { CATEGORIES, categoryById, categoryURL, type CategoryId, type CategoryCounts } from "../lib/categories";

export function CategoryBadge({id}: {id: CategoryId | null | undefined}) {
  const category = categoryById(id);
  if (!category) return null;
  return <Link className="category-badge" data-color={category.color} href={categoryURL(category)}
    aria-label={`Browse ${category.label}`}><span className="category-dot" aria-hidden="true" />{category.label}</Link>;
}

export function CategoryNav({active, counts}: {active?: CategoryId; counts: CategoryCounts}) {
  return <nav className="category-nav" aria-label="Browse stories by category">
    <div className="category-nav-heading">Browse by topic <Link href="/" aria-current={!active ? "page" : undefined}>Top stories ↗</Link></div>
    <ul>{CATEGORIES.map(category => <li key={category.id}>
      <Link href={categoryURL(category)} data-color={category.color} aria-current={active === category.id ? "page" : undefined}>
        <span className="category-dot" aria-hidden="true" /><span>{category.label}</span>
        <span className="category-count" aria-label={`${counts[category.id] ?? 0} stories`}>{counts[category.id] ?? 0}</span>
      </Link>
    </li>)}</ul>
  </nav>;
}

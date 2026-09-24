import Link from "next/link";
import { categoryById, categoryURL, type CategoryId } from "../lib/categories";

export function CategoryBadge({id}: {id: CategoryId | null | undefined}) {
  const category = categoryById(id);
  if (!category) return null;
  return <Link className="category-badge" data-color={category.color} href={categoryURL(category)}
    aria-label={`Browse ${category.label}`}>{category.label}</Link>;
}

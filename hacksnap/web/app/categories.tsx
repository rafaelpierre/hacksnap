import { categoryById, categoryURL, type CategoryId } from "../lib/categories";
import { NavigationPendingLink } from "./navigation-pending-link";

export function CategoryBadge({ id }: { id: CategoryId | null | undefined }) {
  const category = categoryById(id);
  if (!category) return null;
  return (
    <NavigationPendingLink
      className="category-badge"
      href={categoryURL(category)}
      aria-label={`Browse ${category.label}`}
      pendingLabel={`Loading ${category.label}…`}
    >
      {category.label}
    </NavigationPendingLink>
  );
}

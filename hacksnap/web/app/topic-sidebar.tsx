import type { CategoryId } from "../lib/categories";
import { MainNavigation } from "./main-navigation";

export function TopicSidebar({ active }: { active?: CategoryId | "home" }) {
  return (
    <aside className="topic-sidebar desktop-navigation" aria-label="Site navigation">
      <MainNavigation active={active} />
    </aside>
  );
}

/** Route content sits inside the persistent navigation and popularity shell. */
export function BrowseLayout({
  children,
}: {
  children: React.ReactNode;
  active?: CategoryId | "home";
}) {
  return (
    <div className="browse-layout" id="browse-content" tabIndex={-1}>
      {children}
    </div>
  );
}

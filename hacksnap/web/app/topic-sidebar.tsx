import type { CategoryId } from "../lib/categories";
import { MainNavigation } from "./main-navigation";

export function TopicSidebar({ active }: { active?: CategoryId | "home" }) {
  return (
    <aside className="topic-sidebar desktop-navigation" aria-label="Site navigation">
      <MainNavigation active={active} />
    </aside>
  );
}

/** Route content sits inside the shared site shell; supporting content follows the feed. */
export function BrowseLayout({
  children,
  rightSidebar,
}: {
  children: React.ReactNode;
  active?: CategoryId | "home";
  rightSidebar?: React.ReactNode;
}) {
  return (
    <div className="browse-layout">
      <div
        className={rightSidebar ? "browse-content browse-content-with-sidebar" : "browse-content"}
        id="browse-content"
        tabIndex={-1}
      >
        <div className="browse-feed-content">{children}</div>
        {rightSidebar && <div className="browse-right-sidebar">{rightSidebar}</div>}
      </div>
    </div>
  );
}

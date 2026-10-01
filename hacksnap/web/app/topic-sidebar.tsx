import {
  Blocks,
  Building2,
  ChevronRight,
  Code2,
  FlaskConical,
  Newspaper,
  Server,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { CATEGORIES, categoryURL, type CategoryId } from "../lib/categories";
import { NavigationPendingLink } from "./navigation-pending-link";

const topicIcons: Record<CategoryId, LucideIcon> = {
  models_products: Blocks,
  agents_coding: Code2,
  research_evaluation: FlaskConical,
  infrastructure_efficiency: Server,
  safety_privacy: ShieldCheck,
  industry_society: Building2,
};

export function TopicSidebar({ active }: { active?: CategoryId | "home" }) {
  return (
    <aside className="topic-sidebar" aria-labelledby="topic-sidebar-heading">
      <h2 id="topic-sidebar-heading">
        <NavigationPendingLink href="/topics" pendingLabel="Loading topics…">
          Explore topics
        </NavigationPendingLink>
      </h2>
      <nav aria-label="Topics">
        <ul>
          <li>
            <NavigationPendingLink
              href="/"
              aria-current={active === "home" ? "page" : undefined}
              pendingLabel="Loading all stories…"
            >
              <Newspaper className="inline-icon topic-icon" aria-hidden="true" />
              <span className="topic-label">All stories</span>
              <ChevronRight className="inline-icon topic-chevron" aria-hidden="true" />
            </NavigationPendingLink>
          </li>
          {CATEGORIES.map((category) => {
            const Icon = topicIcons[category.id];
            return (
              <li key={category.id}>
                <NavigationPendingLink
                  href={categoryURL(category)}
                  data-color={category.color}
                  aria-current={active === category.id ? "page" : undefined}
                  pendingLabel={`Loading ${category.label}…`}
                >
                  <Icon className="inline-icon topic-icon" aria-hidden="true" />
                  <span className="topic-label">{category.label}</span>
                  <ChevronRight className="inline-icon topic-chevron" aria-hidden="true" />
                </NavigationPendingLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

export function BrowseLayout({
  children,
  active,
}: {
  children: React.ReactNode;
  active?: CategoryId | "home";
}) {
  return (
    <div className="browse-layout">
      <TopicSidebar active={active} />
      <div className="browse-content" id="browse-content" tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}

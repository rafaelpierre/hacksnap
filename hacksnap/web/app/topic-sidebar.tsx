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
import Link from "next/link";
import { CATEGORIES, categoryURL, type CategoryId } from "../lib/categories";

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
        <Link href="/topics">Explore topics</Link>
      </h2>
      <nav aria-label="Topics">
        <ul>
          <li>
            <Link href="/" aria-current={active === "home" ? "page" : undefined}>
              <Newspaper className="inline-icon topic-icon" aria-hidden="true" />
              <span className="topic-label">All stories</span>
              <ChevronRight className="inline-icon topic-chevron" aria-hidden="true" />
            </Link>
          </li>
          {CATEGORIES.map((category) => {
            const Icon = topicIcons[category.id];
            return (
              <li key={category.id}>
                <Link
                  href={categoryURL(category)}
                  data-color={category.color}
                  aria-current={active === category.id ? "page" : undefined}
                >
                  <Icon className="inline-icon topic-icon" aria-hidden="true" />
                  <span className="topic-label">{category.label}</span>
                  <ChevronRight className="inline-icon topic-chevron" aria-hidden="true" />
                </Link>
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

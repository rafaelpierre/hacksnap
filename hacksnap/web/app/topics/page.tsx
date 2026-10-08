import styles from "./page.module.css";
import { availableData } from "../../lib/data-availability";
import { ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import { CATEGORIES, categoryURL } from "../../lib/categories";
import { getCategoryCounts } from "../../lib/data";
import { NavigationPendingLink } from "../navigation-pending-link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Topics",
  description: "Browse AI stories from Hacker News by topic.",
  alternates: { canonical: "/topics" },
};

export default async function TopicsPage() {
  const result = await availableData(getCategoryCounts);
  const counts = result.available ? result.value : null;
  return (
    <section className="supporting-page">
      <header className="feed-header">
        <h1>Browse topics</h1>
        <p>Browse AI stories and Hacker News discussions by subject.</p>
      </header>
      <ul className={`topic-directory ${styles.directory}`}>
        {CATEGORIES.map((category) => (
          <li key={category.id}>
            <NavigationPendingLink
              href={categoryURL(category)}
              pendingLabel={`Loading ${category.label}…`}
            >
              <strong>
                {category.label}
                <ArrowUpRight className="inline-icon" aria-hidden="true" />
              </strong>
              <span className={styles.description}>{category.description}</span>
              <span className={styles.count}>
                {counts
                  ? `${counts[category.id] ?? 0} ${counts[category.id] === 1 ? "story" : "stories"}`
                  : "Story counts unavailable"}
              </span>
            </NavigationPendingLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { CATEGORIES, categoryURL } from "../../lib/categories";
import { getCategoryCounts } from "../../lib/data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Topics",
  description: "Browse AI stories from Hacker News by topic.",
  alternates: {canonical: "/topics"},
};

export default async function TopicsPage() {
  const counts = await getCategoryCounts();
  return <>
    <header className="feed-header">
      <h1>Browse topics</h1>
      <p>Browse AI stories and Hacker News discussions by subject.</p>
    </header>
    <ul className="topic-directory">
      {CATEGORIES.map(category => <li key={category.id}>
        <Link href={categoryURL(category)} data-color={category.color}>
          <strong>{category.label}<span aria-hidden="true">↗</span></strong>
          <span className="topic-description">{category.description}</span>
          <span className="topic-count">{counts[category.id] ?? 0} {counts[category.id] === 1 ? "story" : "stories"}</span>
        </Link>
      </li>)}
    </ul>
  </>;
}

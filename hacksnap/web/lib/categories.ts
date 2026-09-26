export const CATEGORIES = [
  {id: "models_products", slug: "models-products", label: "Models & Products", description: "New models, new capabilities, and AI products worth a closer look.", color: "blue"},
  {id: "agents_coding", slug: "agents-coding", label: "Agents & Coding", description: "Coding assistants, autonomous agents, and the workflows around them.", color: "amber"},
  {id: "research_evaluation", slug: "research-evaluation", label: "Research & Evaluation", description: "Research, scientific discoveries, benchmarks, and tests of what AI can actually do.", color: "purple"},
  {id: "infrastructure_efficiency", slug: "infrastructure-efficiency", label: "Infrastructure & Efficiency", description: "The hardware, systems, and practical costs behind running AI.", color: "green"},
  {id: "safety_privacy", slug: "safety-privacy", label: "Safety & Privacy", description: "Security, alignment, data privacy, and what happens when AI goes wrong.", color: "rose"},
  {id: "industry_society", slug: "industry-society", label: "Industry & Society", description: "How AI is changing business, work, creativity, and everyday life.", color: "sand"},
] as const;

export type Category = typeof CATEGORIES[number];
export type CategoryId = Category["id"];
export type CategoryCounts = Partial<Record<CategoryId, number>>;

export function categoryById(id: string | null | undefined): Category | undefined {
  return CATEGORIES.find(category => category.id === id);
}

export function categoryBySlug(slug: string): Category | undefined {
  return CATEGORIES.find(category => category.slug === slug);
}

export function categoryURL(category: Category, page = 1): string {
  const base = `/category/${category.slug}`;
  return page === 1 ? base : `${base}?page=${page}`;
}

export const CATEGORY_PAGE_SIZE = 30;
export const categoryCountsSQL = `SELECT category, count(*)::int AS count FROM hacker_news_threads
  WHERE category IS NOT NULL AND date_added <= CURRENT_TIMESTAMP
    AND hn_id BETWEEN 1 AND 999999999999999 GROUP BY category`;

export function categoryQuery(fields: string, category: CategoryId, page: number) {
  return {text: `SELECT ${fields} FROM hacker_news_threads t
    LEFT JOIN hacksnap_summaries s ON s.story_id = t.hn_id
    WHERE t.category = $1 AND t.date_added <= CURRENT_TIMESTAMP
      AND t.hn_id BETWEEN 1 AND 999999999999999
    ORDER BY t.date_added DESC, t.hn_id DESC LIMIT $2 OFFSET $3`,
  values: [category, CATEGORY_PAGE_SIZE + 1, (page - 1) * CATEGORY_PAGE_SIZE]};
}

export function relatedStoriesQuery(category: CategoryId, currentStoryId: string) {
  return {text: `SELECT t.hn_id, t.title, t.date_added, s.overall_takeaway AS takeaway
    FROM hacker_news_threads t
    INNER JOIN hacksnap_summaries s ON s.story_id = t.hn_id
    WHERE t.category = $1 AND t.hn_id <> $2
      AND t.date_added <= CURRENT_TIMESTAMP
      AND t.hn_id BETWEEN 1 AND 999999999999999
    ORDER BY t.date_added DESC, t.hn_id DESC LIMIT 3`,
  values: [category, currentStoryId]};
}

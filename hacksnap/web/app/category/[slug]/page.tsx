import { withDataFallback } from "../../with-data-fallback";
import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { categoryMetadata } from "../../../lib/category-metadata";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { getCategoryStories } from "../../../lib/data";
import { shouldStreamBrowse } from "../../../lib/browse-streaming";
import { categoryBySlug, categoryURL, type Category } from "../../../lib/categories";
import { archivePage } from "../../../lib/archive";
import { StoryFeed } from "../../story-feed";
import { browsePagination } from "../../../lib/browse-feed";
import { publicFeedStory } from "../../../lib/stories-api";
import { BrowseLayout } from "../../topic-sidebar";
import { BrowseLoading } from "../../browse-loading";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

async function selection({ params, searchParams }: Props) {
  const category = categoryBySlug((await params).slug);
  const page = archivePage((await searchParams).page);
  if (!category || page === null) notFound();
  return { category, page };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { category, page } = await selection(props);
  return categoryMetadata(category, page);
}

function CategoryShell({ category, children }: { category: Category; children: ReactNode }) {
  return (
    <BrowseLayout active={category.id}>
      <h1 className="sr-only">{category.label}</h1>
      <section aria-label={`${category.label} stories`}>{children}</section>
    </BrowseLayout>
  );
}

const CategoryStories = withDataFallback(async function CategoryStories({
  category,
  page,
}: {
  category: Category;
  page: number;
}) {
  const { stories, hasNext } = await getCategoryStories(category.id, page);
  if (page > 1 && !stories.length) notFound();
  return (
    <CategoryShell category={category}>
      <StoryFeed
        key={`${category.slug}:${page}`}
        listingPath={categoryURL(category)}
        initialStories={stories.map(publicFeedStory)}
        initialPagination={browsePagination(page, hasNext)}
        emptyState={
          <div className="empty">
            <h2>No stories in this topic yet.</h2>
            <p>New stories will appear here as they’re added.</p>
            <Link className="button" href="/">
              Browse latest stories <ChevronRight className="inline-icon" aria-hidden="true" />
            </Link>
          </div>
        }
      />
    </CategoryShell>
  );
});

async function CategoryPage(props: Props) {
  const { category, page } = await selection(props);
  // Empty later pages must return 404; document requests must work without JS.
  if (page > 1 || !(await shouldStreamBrowse())) return CategoryStories({ category, page });
  return (
    <Suspense
      key={`${category.slug}:${page}`}
      fallback={
        <CategoryShell category={category}>
          <BrowseLoading />
        </CategoryShell>
      }
    >
      <CategoryStories category={category} page={page} />
    </Suspense>
  );
}

export default withDataFallback(CategoryPage);

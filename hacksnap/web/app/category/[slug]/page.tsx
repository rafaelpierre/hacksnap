import { availableData } from "../../../lib/data-availability";
import { withDataFallback } from "../../with-data-fallback";
import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import { categoryMetadata } from "../../../lib/category-metadata";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { getCategoryCounts, getCategoryStories } from "../../../lib/data";
import { shouldStreamBrowse } from "../../../lib/browse-streaming";
import {
  categoryBySlug,
  categoryURL,
  type Category,
  type CategoryId,
} from "../../../lib/categories";
import { archivePage } from "../../../lib/archive";
import { StoryFeed } from "../../story-feed";
import { browsePagination } from "../../../lib/browse-feed";
import { publicFeedStory } from "../../../lib/stories-api";
import { BrowseLayout } from "../../topic-sidebar";
import { BrowseLoading } from "../../browse-loading";

async function CategoryCount({ categoryId }: { categoryId: CategoryId }) {
  const result = await availableData(getCategoryCounts);
  return result.available ? (
    <span>{result.value[categoryId] ?? 0}</span>
  ) : (
    <span className="category-count-placeholder" aria-hidden="true" />
  );
}

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

function CategoryShell({
  category,
  count,
  children,
}: {
  category: Category;
  count: ReactNode;
  children: ReactNode;
}) {
  return (
    <BrowseLayout active={category.id}>
      <header className="feed-header category-header" data-color={category.color}>
        <div className="channel-path">
          <Link href="/">hacksnap</Link> / <Link href="/topics">topics</Link> /{" "}
          <span>{category.label}</span>
        </div>
        <h1>
          <span className="category-dot" aria-hidden="true" />
          {category.label}
        </h1>
        <p>{category.description}</p>
      </header>
      <section aria-labelledby="category-stories-heading">
        <div className="feed-bar">
          <h2 id="category-stories-heading">Latest stories {count}</h2>
          <p>Newest first</p>
        </div>
        {children}
      </section>
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
    <CategoryShell
      category={category}
      count={
        <Suspense fallback={<span className="category-count-placeholder" aria-hidden="true" />}>
          <CategoryCount categoryId={category.id} />
        </Suspense>
      }
    >
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
        <CategoryShell
          category={category}
          count={<span className="category-count-placeholder" aria-hidden="true" />}
        >
          <BrowseLoading />
        </CategoryShell>
      }
    >
      <CategoryStories category={category} page={page} />
    </Suspense>
  );
}

export default withDataFallback(CategoryPage);

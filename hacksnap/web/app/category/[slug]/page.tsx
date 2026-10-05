import { notFound, permanentRedirect } from "next/navigation";
import { archivePage } from "../../../lib/archive";
import { categoryBySlug, categoryURL } from "../../../lib/categories";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

export default async function CategoryPage({ params, searchParams }: Props) {
  const category = categoryBySlug((await params).slug);
  const page = archivePage((await searchParams).page);
  if (!category || page === null) notFound();
  permanentRedirect(categoryURL(category, page));
}

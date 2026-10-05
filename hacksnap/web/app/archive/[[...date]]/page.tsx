import { notFound, permanentRedirect } from "next/navigation";
import { archiveMonth, archivePage, archiveURL } from "../../../lib/archive";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ date?: string[] }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

export default async function LegacyArchive({ params, searchParams }: Props) {
  const { date = [] } = await params;
  const month = date.length ? archiveMonth(date) : null;
  const page = archivePage((await searchParams).page);
  if ((date.length && !month) || page === null) notFound();
  permanentRedirect(archiveURL(month, page));
}

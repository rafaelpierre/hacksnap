import Link from "next/link";

export default function ArchiveNotFound() {
  return <div className="empty"><h1>Archive page not found.</h1><p>There are no stories on this archive page.</p><Link className="button" href="/archive">Back to archive</Link></div>;
}

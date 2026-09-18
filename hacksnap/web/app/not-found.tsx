import Link from "next/link";

export default function NotFound() {
  return <div className="empty"><h1>Story not found.</h1><p>This story isn’t in the archive.</p><Link className="button" href="/">Back to stories</Link></div>;
}

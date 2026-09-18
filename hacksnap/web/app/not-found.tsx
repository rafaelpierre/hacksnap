import Link from "next/link";

export default function NotFound() {
  return <div className="empty"><span className="eyebrow">404 / OFF THE RADAR</span><h1>Story not found.</h1><p>This HN story isn’t in our archive.</p><Link className="button primary" href="/">Back to the radar</Link></div>;
}

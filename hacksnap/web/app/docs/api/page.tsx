import Link from "next/link";

export const metadata = {title: "Stories API"};

// Next replaces Vary on HTML page responses. Avoid a shared HTML cache entry
// serving agents the wrong representation before negotiation reaches the proxy.
export const dynamic = "force-dynamic";

export default function ApiDocs() {
  return <article className="detail" style={{overflowWrap: "anywhere"}}>
    <Link className="back-link" href="/">← All stories</Link>
    <h1>Hacksnap Stories API</h1>
    <p>A public, read-only JSON API for Hacker News stories and AI-generated summaries. No authentication is required.</p>
    <p><a href="/openapi.json">OpenAPI specification</a> · <a href="/.well-known/api-catalog">API catalog</a></p>
    <h2>List current stories</h2>
    <pre style={{whiteSpace: "pre-wrap"}}><code>GET https://hacksnap.live/api/stories</code></pre>
    <p>Returns <code>{"{stories: [...], ingestion: string | null}"}</code>. Stories follow the homepage ranking, with the same selection and a shared 30-minute data cache. The ingestion timestamp records the last successful collection. No pagination or query parameters are supported.</p>
    <h2>Get a story</h2>
    <pre style={{whiteSpace: "pre-wrap"}}><code>GET https://hacksnap.live/api/stories/12345678</code></pre>
    <p>Returns one story, including archived stories. IDs are positive decimal strings of up to 15 digits, without leading zeros.</p>
    <h2>Story fields</h2>
    <p>Each story contains <code>hn_id</code> (string), <code>title</code>, <code>category</code> (topic identifier, or null while pending), <code>url</code>, <code>points</code>, <code>comment_count</code>, <code>date_added</code> (UTC timestamp), and <code>summary</code>.</p>
    <p>A summary contains <code>article_summary</code> (string or null), <code>discussion_summary</code>, and <code>overall_takeaway</code>. The entire summary is null while pending. Summaries are AI-generated from sampled source material and may contain errors; consult the original article and Hacker News discussion.</p>
    <h2>Errors and freshness</h2>
    <p>Errors return <code>{"{error: string}"}</code>: 400 for an invalid ID, 404 for an unknown story, and 503 when data is unavailable. Retry a 503 after 60 seconds. Cached lists may retain the last successful result during an outage. Poll the list no more frequently than every 30 minutes.</p>
    <pre style={{whiteSpace: "pre-wrap"}}><code>{'curl https://hacksnap.live/api/stories'}</code></pre>
  </article>;
}

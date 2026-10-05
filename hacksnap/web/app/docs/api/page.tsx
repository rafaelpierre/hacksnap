import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Stories API" };

// Next replaces Vary on HTML page responses. Avoid a shared HTML cache entry
// serving agents the wrong representation before negotiation reaches the proxy.
export const dynamic = "force-dynamic";

export default function ApiDocs() {
  return (
    <article className="detail" style={{ overflowWrap: "anywhere" }}>
      <Link className="back-link" href="/">
        <ChevronLeft className="inline-icon" aria-hidden="true" /> Latest stories
      </Link>
      <h1>Hacksnap Stories API</h1>
      <p>
        A public, read-only JSON API for Hacker News stories and AI-generated summaries. No
        authentication is required.
      </p>
      <p>
        <a href="/openapi.json">OpenAPI specification</a> ·{" "}
        <a href="/.well-known/api-catalog">API catalog</a>
      </p>
      <h2>List current stories</h2>
      <pre style={{ whiteSpace: "pre-wrap" }}>
        <code>GET https://hacksnap.live/api/stories</code>
      </pre>
      <p>
        Returns <code>{"{stories: [...], ingestion: string | null}"}</code>. Stories follow Hacksnap
        ranking, with a 60-second per-instance data cache. The ingestion timestamp records the last
        successful collection. No pagination or query parameters are supported.
      </p>
      <h2>Get a story</h2>
      <pre style={{ whiteSpace: "pre-wrap" }}>
        <code>GET https://hacksnap.live/api/stories/12345678</code>
      </pre>
      <p>
        Returns one story, including archived stories. IDs are positive decimal strings of up to 15
        digits, without leading zeros.
      </p>
      <h2>Story fields</h2>
      <p>
        Each story contains <code>hn_id</code> (string), <code>title</code>, <code>category</code>{" "}
        (topic identifier, or null while pending), <code>url</code>, <code>points</code>,{" "}
        <code>comment_count</code>, <code>date_added</code> (UTC timestamp), and{" "}
        <code>summary</code>.
      </p>
      <p>
        A summary contains <code>article_summary</code> (string or null),{" "}
        <code>discussion_summary</code>, and <code>overall_takeaway</code>. The entire summary is
        null while pending. Summaries are AI-generated from sampled source material and may contain
        errors; consult the original article and Hacker News discussion.
      </p>
      <h2>Discussion analysis</h2>
      <p>
        On the story-detail endpoint, a non-null summary also contains{" "}
        <code>discussion_analysis</code> (object or null). The list endpoint omits this optional
        field; request <code>{"/api/stories/{id}"}</code> for evidence. Existing summary fields are
        preserved. A null or missing analysis means unavailable, including legacy stories; no
        backfill or export regeneration is required.
      </p>
      <p>
        An analysis contains <code>status</code>, <code>analyzed_at</code> (UTC timestamp or null),{" "}
        <code>coverage</code> (object or null), <code>reference_claims</code>,{" "}
        <code>critical_comments</code>, <code>supportive_comments</code>, and <code>topics</code>.
        New analysis uses <code>available</code> or <code>no_comments</code>. Older rows may have{" "}
        <code>insufficient_context</code>. New rows leave claim and stance arrays empty; they remain
        in the response for compatibility. Missing coverage or time is unknown, never borrowed from
        the article summary.
      </p>
      <p>
        Reference claims contain <code>id</code>, <code>text</code>, and <code>source</code> (
        <code>article</code> or <code>story_text</code>). Highlights contain <code>comment_id</code>
        , <code>claim_id</code> (matching a reference claim), <code>stance</code>,{" "}
        <code>paraphrase</code>, and <code>explanation</code>. Critical stances are{" "}
        <code>disagrees</code> or <code>qualified_disagreement</code>; supportive stances are{" "}
        <code>agrees</code> or <code>qualified_agreement</code>. Qualifications and the targeted
        claim were recorded in older analyses; new analyses produce themes only.
      </p>
      <p>
        Topics contain <code>key</code>, <code>title</code>, <code>summary</code>, and{" "}
        <code>comment_ids</code>. Source comments can be read at{" "}
        <code>{"https://news.ycombinator.com/item?id={comment_id}"}</code>. Coverage contains{" "}
        <code>stored_comments</code>, <code>included_comments</code>,{" "}
        <code>comments_truncated</code>, and <code>selection_method</code> (
        <code>active_branches_with_ancestors_v1</code>). The sample selects active branches and
        available parent comments and may omit parts of the full thread. Analysis time is
        independent of article summary generation.
      </p>
      <p>
        Historical highlights are AI-generated paraphrases; their inclusion does not establish
        correctness. Selected themes do not measure community opinion or how common a view is.
        Internal worker metadata and raw source payloads are excluded.
      </p>
      <h2>Errors and freshness</h2>
      <p>
        Errors return <code>{"{error: string}"}</code>: 400 for an invalid ID, 404 for an unknown
        story, and 503 when data is unavailable. Retry a 503 after 60 seconds. Expired lists wait
        for fresh data and return 503 if that read fails. Poll the list no more frequently than
        every 60 seconds.
      </p>
      <pre style={{ whiteSpace: "pre-wrap" }}>
        <code>curl https://hacksnap.live/api/stories</code>
      </pre>
    </article>
  );
}

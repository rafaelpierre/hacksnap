export const apiDocsMarkdown = `# Hacksnap Stories API

A public, read-only JSON API for Hacker News stories and AI-generated summaries. No authentication is required.

[OpenAPI specification](https://hacksnap.live/openapi.json) · [API catalog](https://hacksnap.live/.well-known/api-catalog)

## List current stories

\`GET https://hacksnap.live/api/stories\`

Returns \`{stories: [...], ingestion: string | null}\`. Stories follow the homepage ranking, with the same selection and a shared 30-minute data cache. The ingestion timestamp records the last successful collection. No pagination or query parameters are supported.

## Get a story

\`GET https://hacksnap.live/api/stories/12345678\`

Returns one story, including archived stories. IDs are positive decimal strings of up to 15 digits, without leading zeros.

## Story fields

Each story contains \`hn_id\` (string), \`title\`, \`category\` (topic identifier, or null while pending), \`url\`, \`points\`, \`comment_count\`, \`date_added\` (UTC timestamp), and \`summary\`.

A summary contains \`article_summary\` (string or null), \`discussion_summary\`, and \`overall_takeaway\`. The entire summary is null while pending. Summaries are AI-generated from sampled source material and may contain errors; consult the original article and Hacker News discussion.

## Discussion analysis

On the story-detail endpoint, a non-null summary also contains \`discussion_analysis\` (object or null). The list endpoint omits this optional field; request \`/api/stories/{id}\` for evidence. Existing summary fields are preserved. A null or missing analysis means unavailable, including legacy stories; no backfill or export regeneration is required.

An analysis contains \`status\`, \`analyzed_at\` (UTC timestamp or null), \`coverage\` (object or null), \`reference_claims\`, \`critical_comments\`, \`supportive_comments\`, and \`topics\`. Status is \`available\`, \`no_comments\` (all evidence lists empty), or \`insufficient_context\` (no assessable source claim; themes may still be present, with empty claims and stance highlights). Missing coverage or time is unknown, never borrowed from the article summary.

Reference claims contain \`id\`, \`text\`, and \`source\` (\`article\` or \`story_text\`). Highlights contain \`comment_id\`, \`claim_id\` (matching a reference claim), \`stance\`, \`paraphrase\`, and \`explanation\`. Critical stances are \`disagrees\` or \`qualified_disagreement\`; supportive stances are \`agrees\` or \`qualified_agreement\`. Qualifications and the targeted claim must be retained when displaying a highlight.

Topics contain \`key\`, \`title\`, \`summary\`, and \`comment_ids\`. Source comments can be read at \`https://news.ycombinator.com/item?id={comment_id}\`. Coverage contains \`stored_comments\`, \`included_comments\`, \`comments_truncated\`, and \`selection_method\` (\`active_branches_with_ancestors_v1\`). The sample selects active branches and available parent comments and may omit parts of the full thread. Analysis time is independent of article summary generation.

Highlights are AI-generated paraphrases selected for explicit stance and explanation. Their inclusion does not establish correctness. Empty groups mean no clear examples in the analyzed sample. Selected evidence does not measure community opinion or how common a view is. Internal worker metadata and raw source payloads are excluded.

## Errors and freshness

Errors return \`{error: string}\`: 400 for an invalid ID, 404 for an unknown story, and 503 when data is unavailable. Retry a 503 after 60 seconds. Cached lists may retain the last successful result during an outage. Poll the list no more frequently than every 30 minutes.

\`curl https://hacksnap.live/api/stories\`
`;

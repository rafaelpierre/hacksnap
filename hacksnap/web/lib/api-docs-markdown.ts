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

Each story contains \`hn_id\` (string), \`title\`, \`url\`, \`points\`, \`comment_count\`, \`date_added\` (UTC timestamp), and \`summary\`.

A summary contains \`article_summary\` (string or null), \`discussion_summary\`, and \`overall_takeaway\`. The entire summary is null while pending. Summaries are AI-generated from sampled source material and may contain errors; consult the original article and Hacker News discussion.

## Errors and freshness

Errors return \`{error: string}\`: 400 for an invalid ID, 404 for an unknown story, and 503 when data is unavailable. Retry a 503 after 60 seconds. Cached lists may retain the last successful result during an outage. Poll the list no more frequently than every 30 minutes.

\`curl https://hacksnap.live/api/stories\`
`;

# Hacker News thread reviews

When the user asks to review, summarize, analyze, or discuss a Hacker News thread, use the `mcp__hacker_news_threads__get_hn_thread` MCP tool with the supplied HN ID (and `include_comments: true`) before drafting the response.

Use the `mcp__hacker_news_threads__search_hn_threads` tool only when an ID is not supplied, and use `mcp__hacker_news_threads__list_hn_thread_snapshots` only when historical score or comment-count changes are relevant.

Do not search the local filesystem outside this repository, browse the web, or fetch HN directly for these requests unless the user explicitly asks for additional sources or the MCP does not contain the requested thread. State any MCP comment-limit or truncation in the response when it materially limits the review.

# Social-post voice

When drafting Substack Notes or LinkedIn posts for this user, avoid generic AI prose devices and false-contrast constructions such as “This is not X; it is Y.” Write in a concise, accurate, sarcastic voice with a clear, spiky point of view. Incorporate the strongest source arguments naturally; do not mechanically attribute them to a thread or list them as arguments unless the user asks for attribution or a summary.

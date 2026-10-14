SUMMARY_FORMAT_PROMPT = """
Formatting inside JSON prose values:
- article_summary starts with a short opening paragraph. For a substantive source,
  organize the remaining explanation under 1–2 informative Markdown H2 headings
  (## Heading). Use an H3 (### Heading) only for a genuine subsection of an H2.
  Separate headings and paragraphs with blank lines. Keep the existing word budget;
  a very short source can remain one paragraph. Never add sections just to fill space.
- Use **bold** sparingly in article_summary, article_key_points, discussion_points
  summaries and discussion_analysis topic summaries: emphasize a key finding, number
  or qualification that helps scanning. Usually one short phrase per paragraph or
  bullet is enough; zero is fine. Never bold entire sentences or every key point.
- Headings belong only in article_summary. Article key points and discussion
  topic/point summaries remain inline prose; the application supplies their lists and headings.
- Keep overall_takeaway, topic/point titles and discussion_summary plain text.
  Never put Markdown markers in titles, citation fields or empty-state notices.
- The only supported formatting is ## / ### headings and **bold**. Do not output
  HTML, links, images, code, blockquotes, tables, embedded lists or fenced Markdown.
  Return the complete JSON object, with formatting only inside the allowed strings.
"""

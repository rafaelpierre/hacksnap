SUMMARY_FORMAT_PROMPT = """
Formatting inside JSON prose values:
- article_summary starts with 1–2 sentences, at most 60 words, stating the main
  development and result with any qualification needed to interpret them. Move
  hardware identifiers, procedural steps, secondary examples and patch status into
  later paragraphs or article_key_points unless essential to that opening claim.
- The 160-240-word target is for the whole substantive article_summary, not its
  opening. Use multiple short paragraphs, each developing one idea in 1–3 sentences
  and at most 80 words. Do not pack the full explanation into the lead or repeat it
  in article_key_points. A brief source can stay one paragraph within the opening
  limit; never pad it to meet the overall target.
- For a substantive source, organize the explanation after the opening under
  1–2 informative Markdown H2 headings
  (## Heading). Use an H3 (### Heading) only for a genuine subsection of an H2.
  Separate headings and paragraphs with blank lines (escaped as \\n\\n inside JSON).
  A single newline does not create a paragraph. Never add sections just to fill space.
  Before returning, check the opening length and paragraph boundaries; split or move
  details while preserving supported facts, test conditions and qualifications.
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

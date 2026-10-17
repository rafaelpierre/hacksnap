import re

SUMMARY_FORMAT_PROMPT = """
Formatting inside JSON prose values:
- article_summary starts with 1–2 sentences, at most 60 words, stating the main
  development and result with any qualification needed to interpret them. Move
  hardware identifiers, procedural steps, secondary examples and patch status into
  later paragraphs or article_key_points unless essential to that opening claim.
- Always separate sentences with whitespace. Check for accidentally joined endings
  and openings such as "April 1998.Claude" before returning the JSON.
- The 80-120-word target is for the whole substantive article_summary, not its
  opening. Use one or two short paragraphs, each developing one idea in 1–3 sentences
  and at most 80 words. Do not pack the full explanation into the lead or repeat it
  in article_key_points. A brief source can stay one paragraph within the opening
  limit; never pad it to meet the overall target.
- Keep the overview to one or two short paragraphs without headings. Reserve
  concrete implementation details, numbers and secondary limitations for key points.
  Each key point must add a fact absent from the overview; do not retell the overview
  as bullets. Preserve qualifications needed to interpret a claim.
  Separate paragraphs with blank lines (escaped as \\n\\n inside JSON).
- Use **bold** sparingly in article_summary, article_key_points, discussion_points
  summaries and discussion_analysis topic summaries: emphasize a key finding, number
  or qualification that helps scanning. Usually one short phrase per paragraph or
  bullet is enough; zero is fine. Never bold entire sentences or every key point.
- Article key points and discussion topic/point summaries remain inline prose;
  the application supplies their lists and headings.
- Keep overall_takeaway, topic/point titles and discussion_summary plain text.
  Never put Markdown markers in titles, citation fields or empty-state notices.
- The only supported formatting is ## / ### headings and **bold**. Do not output
  HTML, links, images, code, blockquotes, tables, embedded lists or fenced Markdown.
  Return the complete JSON object, with formatting only inside the allowed strings.
"""


def article_readability_issues(text: str | None) -> list[str]:
    """Cheap structural checks; the editor still owns sentence meaning and revisions."""
    if not text:
        return []
    body = re.sub(r"(?m)^[ \t]{0,3}#{1,6}[ \t]+.*(?:\n|$)", "\n\n", text)
    paragraphs = [block.strip() for block in re.split(r"\n\s*\n", body.strip())
                  if block.strip()]
    issues = []
    for index, paragraph in enumerate(paragraphs):
        limit = 60 if index == 0 else 80
        if len(paragraph.split()) > limit:
            issues.append(
                f"/article_summary: paragraph {index + 1} exceeds {limit} words; "
                "revise into short paragraphs separated by blank lines, moving secondary "
                "detail to non-repeating key points without losing qualifications"
            )
    prose = re.sub(r"`[^`]*`|(?:https?://|www\.)\S+|\S+@\S+", "", text)
    if re.search(r"(?:[a-z0-9][.!?](?=(?:The|This|These|Those|It|Its|They|Their|We|Our|But|"
                 r"However|Yet|Meanwhile|Researchers|Further|For|In|On|A|An)\b)|"
                 r"\b(?:19|20)\d{2}\.(?=[A-Z][a-z]))", prose):
        issues.append("/article_summary: check missing whitespace between sentences; "
                      "separate joined sentences while preserving technical names and values")
    return issues

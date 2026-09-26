/** Legacy summaries remain available in full in TLDR; never CSS-clamp prose. */
export function briefExcerpt(value: string | null | undefined): string {
  const text = value?.trim().replace(/\s+/g, " ") ?? "";
  if (text.length <= 220) return text;
  const sentences = [...new Intl.Segmenter("en", {granularity: "sentence"}).segment(text)];
  let excerpt = "";
  for (const {segment} of sentences) {
    const candidate = (excerpt + segment).trimEnd();
    if (candidate.length > 220) break;
    excerpt += segment;
  }
  if (excerpt.trim()) return excerpt.trim();
  // A semicolon separates independent clauses; keep a readable opening clause
  // for older one-sentence paragraphs, with the full takeaway retained in TLDR.
  const clause = text.indexOf(";");
  if (clause >= 40 && clause < 220) return text.slice(0, clause).trimEnd() + ".";
  const head = text.slice(0, 219).replace(/[\uD800-\uDBFF]$/, "");
  const boundary = head.lastIndexOf(" ");
  return head.slice(0, boundary > 0 ? boundary : 219).trimEnd() + "…";
}

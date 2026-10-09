import { sentences } from "sbd";

export function briefOpening(value: string | null | undefined): string {
  const paragraph =
    value
      ?.trim()
      .split(/\r?\n\s*\r?\n/, 1)[0]
      .replace(/\s+/g, " ") ?? "";
  for (const match of paragraph.matchAll(/\p{P}/gu)) {
    const index = match.index;
    // Apostrophes and hyphens within words belong to the linked excerpt.
    if (
      /['’\-‐‑]/u.test(match[0]) &&
      /[\p{L}\p{N}]$/u.test(paragraph.slice(0, index)) &&
      /^[\p{L}\p{N}]/u.test(paragraph.slice(index + match[0].length))
    )
      continue;
    return paragraph.slice(0, index).trimEnd();
  }
  return paragraph;
}

export function briefSentences(value: string | null | undefined): string[] {
  // Match HTML's whitespace collapsing before detecting sentence boundaries.
  const text = value?.trim().replace(/\s+/g, " ") ?? "";
  return sentences(text, { preserve_whitespace: true });
}

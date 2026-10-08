import { sentences } from "sbd";

export function briefSentences(value: string | null | undefined): string[] {
  // Match HTML's whitespace collapsing before detecting sentence boundaries.
  const text = value?.trim().replace(/\s+/g, " ") ?? "";
  return sentences(text, { preserve_whitespace: true });
}

export function sentimentLabel(value: -1 | 0 | 1 | null, noComments = false): string {
  return value === null ? (noComments ? "No comments" : "Pending")
    : ({"-1": "Skeptical", "0": "Neutral", "1": "Excited"} as const)[value];
}

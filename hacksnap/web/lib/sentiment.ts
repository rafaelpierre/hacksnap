export function sentimentLabel(value: -1 | 0 | 1 | null, noComments = false): string {
  return value === null ? (noComments ? "No comments" : "Pending")
    : ({"-1": "Skeptical", "0": "Neutral", "1": "Excited"} as const)[value];
}

// Positions are display conventions for existing categories, not numeric scores.
export function skepticismDisplay(value: -1 | 0 | 1 | null, noComments = false) {
  if (value === null) return { label: noComments ? "No comments" : "Pending", position: null };
  return { label: value === -1 ? "High" : "Low", position: value === -1 ? 80 : value === 0 ? 20 : 5 };
}

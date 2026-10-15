// Keep the existing feed preview contract without shipping the article parser
// through client-side feed navigation. Only the generated bold subset is removed.
export function summaryPreviewText(value: string): string {
  const parts: string[] = [];
  let offset = 0;
  let opening: { index: number; length: number; startsWithText: boolean } | null = null;
  for (const delimiter of value.matchAll(/\*{2,}/g)) {
    const startsWithText = /\S/.test(value[delimiter.index + delimiter[0].length] ?? "");
    const canOpen =
      delimiter[0].length === 2 && value[delimiter.index - 1] !== "\\" && startsWithText;
    const canClose = /\S/.test(value[delimiter.index - 1] ?? "");
    if (!opening || (opening.startsWithText && canOpen && !canClose)) {
      opening = { index: delimiter.index, length: delimiter[0].length, startsWithText };
      continue;
    }
    const text = value.slice(opening.index + opening.length, delimiter.index);
    if (
      opening.length === 2 &&
      delimiter[0].length === 2 &&
      value[opening.index - 1] !== "\\" &&
      value[delimiter.index - 1] !== "\\" &&
      text.length > 0 &&
      text === text.trim() &&
      !/[*\r\n]/.test(text)
    ) {
      parts.push(value.slice(offset, opening.index), text);
      offset = delimiter.index + delimiter[0].length;
    }
    opening = null;
  }
  parts.push(value.slice(offset));
  return parts.join("");
}

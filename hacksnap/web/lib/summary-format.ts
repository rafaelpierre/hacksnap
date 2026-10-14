export type SummarySpan = { text: string; strong: boolean };
export type SummaryBlock = { kind: "paragraph" | "h2" | "h3"; text: string };

// A deliberately small Markdown subset. Everything else remains literal text.
export function summarySpans(value: string): SummarySpan[] {
  const spans: SummarySpan[] = [];
  let offset = 0;
  let opening: { index: number; length: number; canOpen: boolean } | null = null;
  for (const delimiter of value.matchAll(/\*{2,}/g)) {
    const canOpen =
      delimiter[0].length === 2 &&
      value[delimiter.index - 1] !== "\\" &&
      /\S/.test(value[delimiter.index + delimiter[0].length] ?? "");
    const canClose = /\S/.test(value[delimiter.index - 1] ?? "");
    // An opening-only marker starts a new pair after an unmatched valid opener.
    // Keep malformed pairs reserved so their closing marker cannot be reused.
    if (!opening || (opening.canOpen && canOpen && !canClose)) {
      opening = { index: delimiter.index, length: delimiter[0].length, canOpen };
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
      if (opening.index > offset)
        spans.push({ text: value.slice(offset, opening.index), strong: false });
      spans.push({ text, strong: true });
      offset = delimiter.index + delimiter[0].length;
    }
    // Consume invalid pairs too: their closing marker must never open a later phrase.
    opening = null;
  }
  if (offset < value.length) spans.push({ text: value.slice(offset), strong: false });
  return spans;
}

export function summaryBlocks(value: string): SummaryBlock[] {
  const blocks: SummaryBlock[] = [];
  let paragraph: string[] = [];
  let hasSection = false;
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const line of value.replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^(#{2,3})[ \t]+(\S.*)$/.exec(line);
    if (heading) {
      flush();
      // An orphan H3 becomes H2 so malformed output cannot skip a heading level.
      const kind = heading[1] === "###" && hasSection ? "h3" : "h2";
      blocks.push({ kind, text: heading[2].trim() });
      hasSection = true;
    } else if (!line.trim()) flush();
    else paragraph.push(line.trim().replace(/\s+/g, " "));
  }
  flush();
  return blocks;
}

export function summaryInlineText(value: string): string {
  return summarySpans(value)
    .map((span) => span.text)
    .join("");
}

export function summaryPlainText(value: string): string {
  return summaryBlocks(value)
    .map((block) => summaryInlineText(block.text))
    .join("\n\n");
}

export function escapeMarkdownText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/([\\`*_{}[\]<>#+.!|~-])/g, "\\$1");
}

export function summaryInlineMarkdown(value: string): string {
  return summarySpans(value)
    .map((span) => {
      const escaped = escapeMarkdownText(span.text);
      return span.strong ? `**${escaped}**` : escaped;
    })
    .join("");
}

export function summaryMarkdown(value: string): string {
  return summaryBlocks(value)
    .map((block) => {
      const prefix = block.kind === "h2" ? "## " : block.kind === "h3" ? "### " : "";
      return prefix + summaryInlineMarkdown(block.text);
    })
    .join("\n\n");
}

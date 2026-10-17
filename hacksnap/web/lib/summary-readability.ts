import type { PhrasingContent, Root, Paragraph } from "mdast";

const sentences = new Intl.Segmenter("en", { granularity: "sentence" });
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

// Deliberately limited: arbitrary dots may belong to domains, versions or identifiers.
// Repair common sentence openings and a year followed by a capitalized word.
export function sentenceSpacing(text: string): string {
  return text.replace(
    /(?:[a-z0-9][.!?](?=(?:The|This|These|Those|It|Its|They|Their|We|Our|But|However|Yet|Meanwhile|Researchers|Further|For|In|On|A|An)\b)|\b(?:19|20)\d{2}\.(?=[A-Z][a-z]))/g,
    (match, offset: number) => {
      const token =
        (text.slice(0, offset).match(/\S*$/)?.[0] ?? "") +
        (text.slice(offset).match(/^\S*/)?.[0] ?? "");
      return /[/:@]/.test(token) || token.startsWith("www.") ? match : match + " ";
    },
  );
}

function inlineText(node: PhrasingContent): string {
  if (node.type === "break") return "\n";
  if ("value" in node) return node.value;
  if ("children" in node) return node.children.map(inlineText).join("");
  return "alt" in node ? (node.alt ?? "") : "";
}

function repairSpacing(nodes: PhrasingContent[]) {
  for (const node of nodes) {
    if (node.type === "text") node.value = sentenceSpacing(node.value);
    else if (node.type === "strong" || node.type === "emphasis") repairSpacing(node.children);
  }
}

// A boundary may split emphasis, but never a link, code fragment or other atom.
function canSplit(nodes: PhrasingContent[], offset: number): boolean {
  for (const node of nodes) {
    const length = inlineText(node).length;
    if (offset > 0 && offset < length) {
      if (node.type === "strong" || node.type === "emphasis")
        return canSplit(node.children, offset);
      return node.type === "text";
    }
    offset -= length;
  }
  return true;
}

function sliceInline(nodes: PhrasingContent[], start: number, end: number): PhrasingContent[] {
  const result: PhrasingContent[] = [];
  let offset = 0;
  for (const node of nodes) {
    const length = inlineText(node).length;
    const from = Math.max(0, start - offset);
    const to = Math.min(length, end - offset);
    if (from < to) {
      if (node.type === "text") result.push({ ...node, value: node.value.slice(from, to) });
      else if (node.type === "strong" || node.type === "emphasis")
        result.push({ ...node, children: sliceInline(node.children, from, to) });
      else result.push(node);
    }
    offset += length;
  }
  return result;
}

function shortParagraphs(node: Paragraph, limit: number): Paragraph[] {
  const text = node.children.map(inlineText).join("");
  if (words(text) <= limit) return [node];
  const boundaries = [0];
  let count = 0;
  for (const sentence of sentences.segment(text)) {
    const start = boundaries.at(-1) ?? 0;
    const before = text.slice(0, sentence.index).trimEnd();
    // ICU treats some titles as sentences; do not separate a title from its name.
    const abbreviation = /\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|e\.g|i\.e)\.$/i.test(before);
    if (
      sentence.index > start &&
      (count >= 2 ||
        words(text.slice(start, sentence.index + sentence.segment.length)) >
          (boundaries.length === 1 ? 60 : 80)) &&
      !abbreviation &&
      canSplit(node.children, sentence.index)
    ) {
      boundaries.push(sentence.index);
      count = 0;
    }
    count++;
  }
  boundaries.push(text.length);
  return boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1];
    const content = text.slice(start, end);
    return {
      type: "paragraph",
      children: sliceInline(
        node.children,
        start + content.length - content.trimStart().length,
        end - (content.length - content.trimEnd().length),
      ),
    };
  });
}

export function readableSummary(tree: Root): void {
  // Recurse through prose blocks for spacing only. Explicit list/quote structure stays intact.
  function repair(node: Root | Root["children"][number]) {
    if (node.type === "paragraph" || node.type === "heading") repairSpacing(node.children);
    else if ("children" in node && ["root", "blockquote", "list", "listItem"].includes(node.type))
      node.children.forEach((child) => repair(child));
  }
  repair(tree);
  let firstParagraph = true;
  tree.children = tree.children.flatMap<Root["children"][number]>((node) => {
    if (node.type !== "paragraph") return [node];
    const limit = firstParagraph ? 60 : 80;
    firstParagraph = false;
    return shortParagraphs(node, limit);
  });
}

/** Parse only the plain-text bullet convention emitted by the summary worker.
 * Legacy prose stays as paragraphs; all content is escaped by its output renderer.
 */
export type DiscussionBriefBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

export function discussionBriefBlocks(text: string): DiscussionBriefBlock[] {
  const blocks: DiscussionBriefBlock[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  };
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("- ") && line.slice(2).trim()) {
      flushParagraph();
      const item = line.slice(2).trim();
      const previous = blocks.at(-1);
      if (previous?.type === "list") previous.items.push(item);
      else blocks.push({ type: "list", items: [item] });
    } else if (line) {
      paragraph.push(line);
    } else {
      flushParagraph();
    }
  }
  flushParagraph();
  return blocks;
}

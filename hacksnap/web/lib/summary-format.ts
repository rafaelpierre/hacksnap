import { fromMarkdown } from "mdast-util-from-markdown";
import { toMarkdown } from "mdast-util-to-markdown";
import { readableSummary } from "./summary-readability";
import { visit } from "unist-util-visit";
import type { Nodes, Definition } from "mdast";

function safeLink(value: string): boolean {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function nodeText(node: Nodes): string {
  if (node.type === "break") return "\n";
  if ("value" in node) return node.value;
  if ("children" in node) {
    const separator = ["root", "list", "listItem", "blockquote"].includes(node.type) ? "\n\n" : "";
    return node.children.map(nodeText).join(separator);
  }
  return "";
}

// Use the same safe CommonMark tree for HTML, Markdown exports and plain text.
export function summaryTree(value: string) {
  const tree = fromMarkdown(value);
  readableSummary(tree);
  const definitions = new Map<string, Definition>();
  visit(tree, "definition", (node) => {
    if (!definitions.has(node.identifier)) definitions.set(node.identifier, node);
  });
  let headingDepth = 1;
  visit(tree, (node, index, parent) => {
    if (!parent || index === undefined) return;
    if (node.type === "heading") {
      node.depth = Math.max(2, Math.min(node.depth, headingDepth + 1)) as typeof node.depth;
      headingDepth = node.depth;
    } else if (node.type === "html") {
      const text = { type: "text" as const, value: node.value };
      parent.children[index] = ["root", "blockquote", "listItem"].includes(parent.type)
        ? { type: "paragraph", children: [text] }
        : text;
    } else if (node.type === "image" || node.type === "imageReference") {
      parent.children[index] = { type: "text", value: node.alt ?? "" };
    } else if (node.type === "linkReference") {
      const definition = definitions.get(node.identifier);
      parent.children[index] =
        definition && safeLink(definition.url)
          ? { type: "link", url: definition.url, title: definition.title, children: node.children }
          : { type: "text", value: nodeText(node) };
    } else if (node.type === "link" && !safeLink(node.url)) {
      parent.children[index] = { type: "text", value: nodeText(node) };
    }
  });
  // Definitions have been resolved, including those inside blockquotes and lists.
  visit(tree, (node) => {
    if ("children" in node)
      node.children = node.children.filter((child) => child.type !== "definition");
  });
  return tree;
}

export function summaryInlineText(value: string): string {
  return nodeText(summaryTree(value)).replace(/\s+/g, " ").trim();
}

export function summaryPlainText(value: string): string {
  return nodeText(summaryTree(value));
}

export function escapeMarkdownText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/([\\`*_{}[\]<>#+.!|~-])/g, "\\$1");
}

export function summaryInlineMarkdown(value: string): string {
  return summaryTree(value)
    .children.map((node) =>
      node.type === "paragraph"
        ? toMarkdown({ type: "root", children: [node] }, { emphasis: "*" }).trimEnd()
        : escapeMarkdownText(nodeText(node)),
    )
    .join(" ")
    .replace(/\n+/g, " ");
}

export function summaryMarkdown(value: string): string {
  return toMarkdown(summaryTree(value), { bullet: "-", emphasis: "*" }).trimEnd();
}

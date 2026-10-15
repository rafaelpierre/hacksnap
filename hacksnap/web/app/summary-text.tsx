import { Fragment, type ReactNode } from "react";
import type { Nodes } from "mdast";
import { summaryTree } from "../lib/summary-format";

function renderNode(node: Nodes, inline: boolean): ReactNode {
  const children =
    "children" in node ? <SummaryNodes nodes={node.children} inline={inline} /> : null;
  switch (node.type) {
    case "text":
      return node.value;
    case "strong":
      return <strong>{children}</strong>;
    case "emphasis":
      return <em>{children}</em>;
    case "inlineCode":
      return <code>{node.value}</code>;
    case "break":
      return <br />;
    case "link":
      return (
        <a
          href={node.url}
          title={node.title ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      );
    case "paragraph":
      return inline ? children : <p>{children}</p>;
    case "heading": {
      if (inline) return children;
      const Heading = `h${node.depth}` as "h2" | "h3" | "h4" | "h5" | "h6";
      return <Heading>{children}</Heading>;
    }
    case "list":
      return inline ? (
        children
      ) : node.ordered ? (
        <ol start={node.start ?? undefined}>{children}</ol>
      ) : (
        <ul>{children}</ul>
      );
    case "listItem":
      return inline ? children : <li>{children}</li>;
    case "blockquote":
      return inline ? children : <blockquote>{children}</blockquote>;
    case "code":
      return inline ? (
        <code>{node.value}</code>
      ) : (
        <pre>
          <code>{node.value}</code>
        </pre>
      );
    case "thematicBreak":
      return inline ? null : <hr />;
    default:
      return children;
  }
}

function SummaryNodes({ nodes, inline = false }: { nodes: Nodes[]; inline?: boolean }) {
  return nodes.map((node, index) => (
    <Fragment key={index}>
      {inline &&
      index > 0 &&
      ["paragraph", "heading", "list", "listItem", "blockquote", "code"].includes(node.type)
        ? " "
        : null}
      {renderNode(node, inline)}
    </Fragment>
  ));
}

export function SummaryInline({ text }: { text: string }) {
  return <SummaryNodes nodes={summaryTree(text).children} inline />;
}

export function ArticleSummary({ text }: { text: string }) {
  return (
    <div className="article-summary">
      <SummaryNodes nodes={summaryTree(text).children} />
    </div>
  );
}

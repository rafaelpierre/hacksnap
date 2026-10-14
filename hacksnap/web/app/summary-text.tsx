import { briefOpening, briefSentences } from "../lib/article-brief";
import { summaryBlocks, summarySpans, type SummarySpan } from "../lib/summary-format";

function InlineSpans({
  spans,
  start = 0,
  end = Infinity,
}: {
  spans: SummarySpan[];
  start?: number;
  end?: number;
}) {
  let offset = 0;
  return spans.map((span, index) => {
    const text = span.text.slice(Math.max(0, start - offset), Math.max(0, end - offset));
    offset += span.text.length;
    if (!text) return null;
    return span.strong ? <strong key={index}>{text}</strong> : text;
  });
}

export function SummaryInline({ text }: { text: string }) {
  return <InlineSpans spans={summarySpans(text)} />;
}

export function ArticleSummary({ text, sourceUrl }: { text: string; sourceUrl: string | null }) {
  const blocks = summaryBlocks(text);
  const openingIndex = blocks.findIndex((block) => block.kind === "paragraph");
  return (
    <div className="article-summary">
      {blocks.map((block, blockIndex) => {
        if (block.kind !== "paragraph") {
          const Heading = block.kind;
          return (
            <Heading key={blockIndex}>
              <SummaryInline text={block.text} />
            </Heading>
          );
        }
        const spans = summarySpans(block.text);
        const plain = spans.map((span) => span.text).join("");
        const opening = blockIndex === openingIndex && sourceUrl ? briefOpening(plain) : "";
        let offset = 0;
        return (
          <p key={blockIndex}>
            {briefSentences(plain).map((sentence, index) => {
              const start = offset;
              offset += sentence.length;
              return (
                <span className="article-brief-sentence" key={index}>
                  {index === 0 && sourceUrl && opening ? (
                    <>
                      <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                        <InlineSpans spans={spans} end={opening.length} />
                      </a>
                      <InlineSpans spans={spans} start={opening.length} end={offset} />
                    </>
                  ) : (
                    <InlineSpans spans={spans} start={start} end={offset} />
                  )}
                </span>
              );
            })}
          </p>
        );
      })}
    </div>
  );
}

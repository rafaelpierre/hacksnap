"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopySharePost({text}: {text: string}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }
  return <>
    <button type="button" className="share-link share-copy-button" onClick={copy} aria-label="Copy suggested post">
      {status === "copied" ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      <span className="share-tooltip" aria-hidden="true">{status === "copied" ? "Copied!" : "Copy suggested post"}</span>
    </button>
    <span className={status === "failed" ? "share-copy-hint" : "sr-only"} role="status">
      {status === "copied" ? "Post copied to clipboard." :
        status === "failed" ? "Couldn’t copy automatically. Select and copy the text below." : ""}
    </span>
    {status === "failed" && <textarea className="share-copy-fallback" aria-label="Suggested post — select and copy" readOnly value={text} rows={5} onFocus={event => event.currentTarget.select()} />}
  </>;
}

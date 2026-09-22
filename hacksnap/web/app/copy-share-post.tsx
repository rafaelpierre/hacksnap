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
  return <div className="share-copy">
    <button type="button" className="share-copy-button" onClick={copy}>
      {status === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      Copy suggested post
    </button>
    <span className="share-copy-hint" role="status">
      {status === "copied" ? "Copied — paste into LinkedIn or Facebook." :
        status === "failed" ? "Couldn’t copy automatically. Select and copy the text below." : "For LinkedIn or Facebook"}
    </span>
    {status === "failed" && <textarea className="share-copy-fallback" aria-label="Suggested post — select and copy" readOnly value={text} rows={5} onFocus={event => event.currentTarget.select()} />}
  </div>;
}

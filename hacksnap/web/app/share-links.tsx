"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { shareText } from "../lib/share-text";

// This interface is shared by feed rows and the story page.
export function ShareLinks({id, title, takeaway}: {id: string; title: string; takeaway?: string | null}) {
  const canonical = shareText(id, title, takeaway);
  const instanceId = useId();
  const [open, setOpen] = useState(false);
  const [post, setPost] = useState(canonical.post);
  const [feedback, setFeedback] = useState("");
  const [manual, setManual] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const manualText = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setPost(canonical.post); }, [id, title, takeaway]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  useEffect(() => { if (manual) manualText.current?.select(); }, [manual]);

  async function copy(value: string, label: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      setFeedback(`${label} copied.`);
      setManual("");
    } catch {
      setFeedback(`Couldn’t copy ${label.toLowerCase()}. Select the text below to copy it manually.`);
      setManual(value);
    }
  }

  const xURL = `https://twitter.com/intent/tweet?text=${encodeURIComponent(post)}`;
  const emailURL = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(post.replaceAll("\n", "\r\n"))}`;
  return <div className="share-menu" ref={root} onKeyDown={event => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
  }}>
    <button className="share-trigger" type="button" ref={trigger} aria-expanded={open} aria-controls={`share-menu-${instanceId}`}
      aria-label={`Share ${title}`} onClick={() => { setOpen(!open); setFeedback(""); setManual(""); }}>
      <Share2 size={15} aria-hidden="true" /> Share
    </button>
    {open && <div className="share-menu-panel" id={`share-menu-${instanceId}`}>
      <button type="button" onClick={() => copy(canonical.url, "Link")}>Copy link</button>
      <label htmlFor={`share-post-${instanceId}`}>Suggested post</label>
      <textarea id={`share-post-${instanceId}`} value={post} onChange={event => setPost(event.target.value)} rows={4} />
      <button type="button" onClick={() => copy(post, "Suggested post")}>Copy suggested post</button>
      <div className="share-menu-destinations">
        <a href={xURL} target="_blank" rel="noopener noreferrer">Post on X ↗</a>
        <a href={emailURL}>Email ↗</a>
      </div>
      <p role="status" className="share-feedback">{feedback}</p>
      {manual && <textarea ref={manualText} readOnly value={manual} aria-label="Text to copy manually" rows={4} />}
    </div>}
  </div>;
}

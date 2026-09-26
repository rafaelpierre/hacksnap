"use client";

import {useEffect, useId, useRef, useState} from "react";
import {Share2} from "lucide-react";
import {canonicalStoryUrl, copyText, shareDestinations, suggestedPost} from "../lib/share-text";

type ShareProps = {id: string; title: string; takeaway?: string | null; label?: string};

/** A single disclosure for feed rows and both story-page placements. */
export function ShareLinks({id, title, takeaway, label = "Share"}: ShareProps) {
  const [open, setOpen] = useState(false);
  const [post, setPost] = useState(() => suggestedPost(id, title, takeaway));
  const [feedback, setFeedback] = useState("");
  const [manualText, setManualText] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstAction = useRef<HTMLButtonElement>(null);
  const manualField = useRef<HTMLTextAreaElement>(null);
  const panelId = useId();
  const draftId = useId();
  const url = canonicalStoryUrl(id);

  useEffect(() => {
    if (open) firstAction.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  useEffect(() => {
    if (manualText !== null) {
      manualField.current?.focus();
      manualField.current?.select();
    }
  }, [manualText]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }

  async function copy(value: string, kind: "link" | "post") {
    setManualText(null);
    setFeedback("");
    const succeeded = await copyText(value, navigator.clipboard);
    if (succeeded) {
      setFeedback(kind === "link" ? "Link copied to clipboard." : "Suggested post copied to clipboard.");
    } else {
      setManualText(value);
      setFeedback("Couldn’t copy automatically. Select and copy the text below.");
    }
  }

  return <div
    className="share-menu"
    ref={root}
    onKeyDown={event => { if (event.key === "Escape" && open) { event.stopPropagation(); close(true); } }}
    onBlur={event => { if (open && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
  >
    <button type="button" className="share-trigger" ref={trigger} aria-expanded={open} aria-controls={panelId}
      aria-label={`${label}: ${title}`} onClick={() => { setOpen(!open); setFeedback(""); setManualText(null); }}>
      <Share2 size={16} aria-hidden="true" /> {label}
    </button>
    {open && <section className="share-panel" id={panelId} aria-label={`Share ${title}`}>
      <div className="share-panel-heading"><strong>Share story</strong><button type="button" className="share-close" onClick={() => close(true)} aria-label="Close share menu">×</button></div>
      <div className="share-actions">
        <button type="button" ref={firstAction} onClick={() => void copy(url, "link")}>Copy link</button>
        {shareDestinations(post, url, title).map(destination => <a key={destination.name} href={destination.href}
          target={destination.name === "Email" ? undefined : "_blank"}
          rel={destination.name === "Email" ? undefined : "noopener noreferrer"}
          aria-label={`${destination.name}${destination.name === "Email" ? "" : " (opens in a new tab)"}`}>
          {destination.name} {destination.name !== "Email" && <span aria-hidden="true">↗</span>}
        </a>)}
      </div>
      <p className="share-destination-hint">LinkedIn opens a link preview. Copy your post to paste edits there.</p>
      <label htmlFor={draftId}>Suggested post</label>
      <textarea id={draftId} className="share-draft" value={post} rows={5} onChange={event => { setPost(event.target.value); setFeedback(""); setManualText(null); }} />
      <button type="button" className="share-copy-post" onClick={() => void copy(post, "post")}>Copy suggested post</button>
      <p className="share-feedback" role="status" aria-live="polite">{feedback}</p>
      {manualText !== null && <textarea ref={manualField} className="share-manual" readOnly value={manualText} rows={4}
        aria-label="Text for manual copy" onFocus={event => event.currentTarget.select()} />}
    </section>}
  </div>;
}

"use client";

import { Copy, Link2, Mail, Share2, X } from "lucide-react";
import { FaLinkedinIn, FaXTwitter } from "react-icons/fa6";
import {useEffect, useId, useRef, useState} from "react";
import {copyShareText, track} from "../lib/analytics";
import {canonicalStoryUrl, copyText, shareDestinations, suggestedPost, xPostStatus} from "../lib/share-text";

type ShareProps = {id: string; title: string; takeaway?: string | null; label?: string; placement?: string};

/** A single disclosure for feed rows and both story-page placements. */
export function ShareLinks({id, title, takeaway, label = "Share", placement = "feed"}: ShareProps) {
  const [open, setOpen] = useState(false);
  const [post, setPost] = useState(() => suggestedPost(id, title, takeaway));
  const [feedback, setFeedback] = useState("");
  const [manualText, setManualText] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstAction = useRef<HTMLButtonElement>(null);
  const manualField = useRef<HTMLTextAreaElement>(null);
  const draftField = useRef<HTMLTextAreaElement>(null);
  const panelId = useId();
  const draftId = useId();
  const xHintId = useId();
  const xStatus = xPostStatus(post);
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
    const succeeded = await copyShareText(value, id, placement, kind, async text => {
      if (!await copyText(text, navigator.clipboard)) throw new Error("Clipboard write failed");
    });
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
      aria-label={`${label}: ${title}`} onClick={() => { if (!open) track("share_menu_open", {story_id: id, placement}); setOpen(!open); setFeedback(""); setManualText(null); }}>
      <Share2 size={16} aria-hidden="true" /> {label}
    </button>
    {open && <section className="share-panel" id={panelId} aria-label={`Share ${title}`}>
      <div className="share-panel-heading"><strong>Share story</strong><button type="button" className="share-close" onClick={() => close(true)} aria-label="Close share menu"><X size={18} aria-hidden="true" /></button></div>
      <div className="share-actions">
        <button type="button" ref={firstAction} onClick={() => void copy(url, "link")}><Link2 size={20} aria-hidden="true" /><span>Copy link</span></button>
        {shareDestinations(post, url, title).map(destination => {
          const Icon = destination.name === "X" ? FaXTwitter : destination.name === "LinkedIn" ? FaLinkedinIn : Mail;
          return destination.name === "X" && !xStatus.valid
          ? <button key="X" type="button" aria-describedby={xHintId} onClick={() => {
              setFeedback(`X needs a shorter post (${xStatus.length}/${xStatus.limit}). Edit the suggested post to continue.`);
              draftField.current?.focus();
            }}><Icon size={20} aria-hidden="true" /><span>X <small>(edit first)</small></span></button>
          : <button key={destination.name} type="button"
              onClick={() => {
                track("share_destination_select", {story_id: id, destination: destination.name.toLowerCase(), placement});
                // Keep edited drafts out of DOM URLs and GA automatic outbound-link events.
                if (destination.name === "Email") window.location.assign(destination.href);
                else window.open(destination.href, "_blank", "noopener,noreferrer");
              }}
              aria-label={`${destination.name}${destination.name === "Email" ? "" : " (opens in a new tab)"}`}>
              <Icon size={20} aria-hidden="true" /><span>{destination.name}</span>
            </button>; })}
      </div>
      <div className="share-draft-heading"><label htmlFor={draftId}>Suggested post</label><span className="share-count" data-over-limit={!xStatus.valid}>{xStatus.length}/{xStatus.limit} on X</span></div>
      <textarea id={draftId} ref={draftField} className="share-draft" aria-describedby={xHintId} value={post} rows={5} onChange={event => { setPost(event.target.value); setFeedback(""); setManualText(null); }} />
      <p id={xHintId} className="share-destination-hint">{!xStatus.valid ? "Shorten the draft to share on X. " : ""}LinkedIn shares the link; paste your copied post there.</p>
      <button type="button" className="share-copy-post" onClick={() => void copy(post, "post")}><Copy size={16} aria-hidden="true" />Copy suggested post</button>
      <p className="share-feedback" role="status" aria-live="polite">{feedback}</p>
      {manualText !== null && <textarea ref={manualField} className="share-manual" readOnly value={manualText} rows={4}
        aria-label="Text for manual copy" onFocus={event => event.currentTarget.select()} />}
    </section>}
  </div>;
}

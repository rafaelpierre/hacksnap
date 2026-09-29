"use client";

import { Share2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { copyShareText, track } from "../lib/analytics";
import { canonicalStoryUrl, copyText, shareDestinations, suggestedPost } from "../lib/share-text";
import { loadShareEditor } from "./share-editor-loader";

type ShareProps = {
  id: string;
  slug?: string | null;
  title: string;
  takeaway?: string | null;
  label?: string;
  placement?: string;
};

type ShareEditorComponent = typeof import("./share-editor").ShareEditor;

/** The feed mounts only this small trigger; the editor and X parser load on first open. */
export function ShareLinks({
  id,
  slug,
  title,
  takeaway,
  label = "Share",
  placement = "feed",
}: ShareProps) {
  const [open, setOpen] = useState(false);
  const [post, setPost] = useState(() => suggestedPost(id, title, takeaway, slug));
  const [feedback, setFeedback] = useState("");
  const [manualText, setManualText] = useState<string | null>(null);
  const [Editor, setEditor] = useState<ShareEditorComponent | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstAction = useRef<HTMLButtonElement>(null);
  const manualField = useRef<HTMLTextAreaElement>(null);
  const pendingEditorFocus = useRef<string | null>(null);
  const retryHadFocus = useRef(false);
  const panelId = useId();
  const url = canonicalStoryUrl(id, slug);

  useEffect(() => {
    if (open) firstAction.current?.focus();
  }, [open]);

  useEffect(() => {
    const label = pendingEditorFocus.current;
    pendingEditorFocus.current = null;
    if (!open || !Editor || !label) return;
    const actions = root.current?.querySelectorAll<HTMLButtonElement>(
      ".share-actions button, .share-copy-post",
    );
    const matchingAction = [...(actions ?? [])].find(
      (button) => button.textContent?.trim() === label,
    );
    (matchingAction ?? firstAction.current)?.focus();
  }, [Editor, open]);

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

  function loadEditor() {
    const active = document.activeElement;
    retryHadFocus.current = Boolean(
      active instanceof HTMLElement &&
      root.current?.contains(active) &&
      active.tagName === "BUTTON" &&
      active.textContent?.trim() === "Retry editor",
    );
    setLoadFailed(false);
    void loadShareEditor()
      .then(({ ShareEditor }) => {
        const active = document.activeElement;
        pendingEditorFocus.current = null;
        if (
          active instanceof HTMLElement &&
          root.current?.contains(active) &&
          active.tagName === "BUTTON" &&
          (active.closest(".share-actions") || active.classList.contains("share-copy-post"))
        ) {
          pendingEditorFocus.current = active.textContent?.trim() || "Copy link";
        } else if (active === document.body && retryHadFocus.current) {
          pendingEditorFocus.current = "Copy link";
        }
        retryHadFocus.current = false;
        setEditor(() => ShareEditor);
      })
      .catch(() => {
        retryHadFocus.current = false;
        setLoadFailed(true);
      });
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }

  async function copy(value: string, kind: "link" | "post") {
    setManualText(null);
    setFeedback("");
    const succeeded = await copyShareText(value, id, placement, kind, async (text) => {
      if (!(await copyText(text, navigator.clipboard))) throw new Error("Clipboard write failed");
    });
    if (succeeded) {
      setFeedback(
        kind === "link" ? "Link copied to clipboard." : "Suggested post copied to clipboard.",
      );
    } else {
      setManualText(value);
      setFeedback("Couldn’t copy automatically. Select and copy the text below.");
    }
  }

  function selectDestination(name: string, href: string) {
    track("share_destination_select", {
      story_id: id,
      destination: name.toLowerCase(),
      placement,
    });
    // Keep edited drafts out of DOM URLs and GA automatic outbound-link events.
    if (name === "Email") window.location.assign(href);
    else window.open(href, "_blank", "noopener,noreferrer");
  }

  return (
    <div
      className="share-menu"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          close(true);
        }
      }}
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        type="button"
        className="share-trigger"
        ref={trigger}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${label}: ${title}`}
        onClick={() => {
          if (!open) {
            track("share_menu_open", { story_id: id, placement });
            if (!Editor && !loadFailed) loadEditor();
          }
          setOpen(!open);
          setFeedback("");
          setManualText(null);
        }}
      >
        <Share2 size={16} aria-hidden="true" /> {label}
      </button>
      {open && (
        <section className="share-panel" id={panelId} aria-label={`Share ${title}`}>
          <div className="share-panel-heading">
            <strong>Share story</strong>
            <button
              type="button"
              className="share-close"
              onClick={() => close(true)}
              aria-label="Close share menu"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          {Editor ? (
            <Editor
              title={title}
              url={url}
              post={post}
              onPostChange={(value) => {
                setPost(value);
                setFeedback("");
                setManualText(null);
              }}
              onCopy={(value, kind) => void copy(value, kind)}
              onDestination={selectDestination}
              onFeedback={setFeedback}
              firstActionRef={firstAction}
            />
          ) : (
            <>
              <p className="share-load-status" role="status">
                {loadFailed
                  ? "The post editor couldn’t load. Link and other sharing options still work."
                  : "Loading post editor…"}
              </p>
              <div className="share-actions">
                <button type="button" ref={firstAction} onClick={() => void copy(url, "link")}>
                  Copy link
                </button>
                {shareDestinations(post, url, title)
                  .filter((destination) => destination.name !== "X")
                  .map((destination) => (
                    <button
                      key={destination.name}
                      type="button"
                      onClick={() => selectDestination(destination.name, destination.href)}
                      aria-label={`${destination.name}${destination.name === "Email" ? "" : " (opens in a new tab)"}`}
                    >
                      {destination.name}
                    </button>
                  ))}
              </div>
              <button
                type="button"
                className="share-copy-post"
                onClick={() => void copy(post, "post")}
              >
                Copy suggested post
              </button>
              {loadFailed && (
                <button type="button" className="share-copy-post" onClick={loadEditor}>
                  Retry editor
                </button>
              )}
            </>
          )}
          <p className="share-feedback" role="status" aria-live="polite">
            {feedback}
          </p>
          {manualText !== null && (
            <textarea
              ref={manualField}
              className="share-manual"
              readOnly
              value={manualText}
              rows={4}
              aria-label="Text for manual copy"
              onFocus={(event) => event.currentTarget.select()}
            />
          )}
        </section>
      )}
    </div>
  );
}

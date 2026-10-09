"use client";

import { Forward, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { copyShareText, track } from "../lib/analytics";
import {
  canonicalStoryUrl,
  copyText,
  linkedInPost,
  shareDestinations,
  suggestedPost,
} from "../lib/share-text";
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
  const [postEdited, setPostEdited] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [linkedInHref, setLinkedInHref] = useState<string | null>(null);
  const [manualText, setManualText] = useState<string | null>(null);
  const [Editor, setEditor] = useState<ShareEditorComponent | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstAction = useRef<HTMLButtonElement>(null);
  const manualField = useRef<HTMLTextAreaElement>(null);
  const pendingEditorFocus = useRef<string | null>(null);
  const retryHadFocus = useRef(false);
  const currentIdentity = useRef(id);
  const previousIdentity = useRef(id);
  const copyGeneration = useRef(0);
  const copyOperation = useRef(0);
  const panelId = useId();
  const url = canonicalStoryUrl(id, slug);

  currentIdentity.current = id;

  useLayoutEffect(() => {
    if (previousIdentity.current === id) return;
    previousIdentity.current = id;
    copyGeneration.current += 1;
    copyOperation.current += 1;
    setPost(suggestedPost(id, title, takeaway, slug));
    setPostEdited(false);
    setFeedback("");
    setManualText(null);
    setLinkedInHref(null);
  }, [id, slug, title, takeaway]);

  useLayoutEffect(() => {
    if (postEdited) return;
    const refreshedPost = suggestedPost(id, title, takeaway, slug);
    if (post === refreshedPost) return;
    copyGeneration.current += 1;
    setFeedback("");
    setManualText(null);
    setLinkedInHref(null);
    setPost(refreshedPost);
  }, [id, slug, title, takeaway, post, postEdited]);

  useEffect(() => {
    if (!open) return;
    const panel = dialog.current;
    if (!panel) return;
    if (typeof panel.showModal === "function") panel.showModal();
    else panel.setAttribute("open", "");
    firstAction.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      if (typeof panel.close === "function" && panel.open) panel.close();
      document.body.style.overflow = previousOverflow;
    };
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
    if (typeof dialog.current?.close === "function") dialog.current.close();
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }

  async function copy(value: string, kind: "link" | "post", destinationHref?: string) {
    const identity = id;
    const generation = copyGeneration.current;
    const operation = ++copyOperation.current;
    setManualText(null);
    setLinkedInHref(null);
    setFeedback("");
    const succeeded = await copyShareText(value, id, placement, kind, async (text) => {
      if (!(await copyText(text, navigator.clipboard))) throw new Error("Clipboard write failed");
    });
    if (
      currentIdentity.current !== identity ||
      copyGeneration.current !== generation ||
      copyOperation.current !== operation
    ) {
      return;
    }
    setLinkedInHref(destinationHref ?? null);
    if (succeeded) {
      setFeedback(
        destinationHref
          ? "Post and link copied. Open LinkedIn, then paste into your post."
          : kind === "link"
            ? "Link copied to clipboard."
            : "Suggested post copied to clipboard.",
      );
    } else {
      setManualText(value);
      setFeedback(
        destinationHref
          ? "Copy the text below, then open LinkedIn and paste it into your post. The story link is included even if its preview fails."
          : "Couldn’t copy automatically. Select and copy the text below.",
      );
    }
  }

  function selectDestination(name: string, href: string) {
    if (name === "LinkedIn") {
      void copy(linkedInPost(post, url), "post", href);
      return;
    }
    openDestination(name, href);
  }

  function trackDestination(name: string) {
    track("share_destination_select", {
      story_id: id,
      destination: name.toLowerCase(),
      placement,
    });
  }

  function openDestination(name: string, href: string) {
    trackDestination(name);
    // Keep edited drafts out of DOM URLs and GA automatic outbound-link events.
    if (name === "Email") window.location.assign(href);
    else window.open(href, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="share-menu" ref={root}>
      <button
        type="button"
        className="share-trigger"
        ref={trigger}
        aria-haspopup="dialog"
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
          setLinkedInHref(null);
        }}
      >
        <Forward size={18} aria-hidden="true" /> {label}
      </button>
      {open && (
        <dialog
          className="share-panel"
          id={panelId}
          ref={dialog}
          aria-labelledby={`${panelId}-heading`}
          aria-describedby={`${panelId}-story`}
          onCancel={(event) => {
            event.preventDefault();
            close(true);
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              close(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close(true);
            } else if (event.key === "Tab") {
              const controls = [
                ...event.currentTarget.querySelectorAll<HTMLElement>(
                  'button:not([disabled]), a[href], textarea:not([disabled]), input:not([disabled]), [tabindex="0"]',
                ),
              ];
              const first = controls[0];
              const last = controls[controls.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <div className="share-panel-heading">
            <h2 id={`${panelId}-heading`}>Share this story</h2>
            <button
              type="button"
              className="share-close"
              onClick={() => close(true)}
              aria-label="Close share dialog"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
          <p className="share-story-title" id={`${panelId}-story`}>
            {title}
          </p>
          {Editor ? (
            <Editor
              title={title}
              url={url}
              post={post}
              postEdited={postEdited}
              onPostChange={(value) => {
                copyGeneration.current += 1;
                setPost(value);
                setPostEdited(value !== suggestedPost(id, title, takeaway, slug));
                setFeedback("");
                setManualText(null);
                setLinkedInHref(null);
              }}
              onResetPost={() => {
                copyGeneration.current += 1;
                setPost(suggestedPost(id, title, takeaway, slug));
                setPostEdited(false);
                setFeedback("");
                setManualText(null);
                setLinkedInHref(null);
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
                      aria-label={
                        destination.name === "LinkedIn"
                          ? "LinkedIn (copy post first)"
                          : destination.name
                      }
                    >
                      {destination.name}
                    </button>
                  ))}
              </div>
              <p className="share-destination-hint">
                LinkedIn needs a paste: copy your post here, then open LinkedIn.
              </p>
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
          {linkedInHref !== null && (
            <a
              href={linkedInHref}
              target="_blank"
              rel="noopener noreferrer"
              className="share-copy-post"
              aria-label="Open LinkedIn (opens in a new tab)"
              onClick={() => trackDestination("LinkedIn")}
            >
              Open LinkedIn
            </a>
          )}
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
        </dialog>
      )}
    </div>
  );
}

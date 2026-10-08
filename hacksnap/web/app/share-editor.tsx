"use client";

import { Copy, Link2, Mail } from "lucide-react";
import { FaLinkedinIn, FaXTwitter } from "react-icons/fa6";
import { useId, useRef } from "react";
import { shareDestinations } from "../lib/share-text";
import { xPostStatus } from "../lib/x-post-status";

type ShareEditorProps = {
  title: string;
  url: string;
  post: string;
  postEdited: boolean;
  onPostChange: (post: string) => void;
  onResetPost: () => void;
  onCopy: (value: string, kind: "link" | "post") => void;
  onDestination: (name: string, href: string) => void;
  onFeedback: (message: string) => void;
  firstActionRef: React.RefObject<HTMLButtonElement | null>;
};

/** Imported only after the reader opens a share control. */
export function ShareEditor({
  title,
  url,
  post,
  postEdited,
  onPostChange,
  onResetPost,
  onCopy,
  onDestination,
  onFeedback,
  firstActionRef,
}: ShareEditorProps) {
  const draftId = useId();
  const xHintId = useId();
  const draftField = useRef<HTMLTextAreaElement>(null);
  const xStatus = xPostStatus(post);

  return (
    <>
      <div className="share-draft-heading">
        <label htmlFor={draftId}>Suggested post</label>
        <span className="share-count" data-over-limit={!xStatus.valid}>
          {xStatus.length}/{xStatus.limit} on X
        </span>
      </div>
      <textarea
        id={draftId}
        ref={draftField}
        className="share-draft"
        aria-describedby={xHintId}
        value={post}
        rows={5}
        onChange={(event) => onPostChange(event.target.value)}
      />
      {postEdited && (
        <button
          type="button"
          className="share-copy-post"
          onClick={() => {
            onResetPost();
            draftField.current?.focus();
          }}
        >
          Reset draft
        </button>
      )}
      <p id={xHintId} className="share-destination-hint">
        {!xStatus.valid ? "Shorten the draft to share on X. " : ""}LinkedIn shares the link; paste
        your copied post there.
      </p>
      <button
        type="button"
        className="share-copy-post share-copy-primary"
        onClick={() => onCopy(post, "post")}
      >
        <Copy size={16} aria-hidden="true" />
        Copy suggested post
      </button>
      <div className="share-actions">
        <button type="button" ref={firstActionRef} onClick={() => onCopy(url, "link")}>
          <Link2 size={20} aria-hidden="true" />
          <span>Copy link</span>
        </button>
        {shareDestinations(post, url, title).map((destination) => {
          const Icon =
            destination.name === "X"
              ? FaXTwitter
              : destination.name === "LinkedIn"
                ? FaLinkedinIn
                : Mail;
          return destination.name === "X" && !xStatus.valid ? (
            <button
              key="X"
              type="button"
              aria-describedby={xHintId}
              onClick={() => {
                onFeedback(
                  `X needs a shorter post (${xStatus.length}/${xStatus.limit}). Edit the suggested post to continue.`,
                );
                draftField.current?.focus();
              }}
            >
              <Icon size={20} aria-hidden="true" />
              <span>
                X <small>(edit first)</small>
              </span>
            </button>
          ) : (
            <button
              key={destination.name}
              type="button"
              onClick={() => onDestination(destination.name, destination.href)}
              aria-label={`${destination.name}${destination.name === "Email" ? "" : " (opens in a new tab)"}`}
            >
              <Icon size={20} aria-hidden="true" />
              <span>{destination.name}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

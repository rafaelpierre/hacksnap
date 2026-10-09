"use client";

import { Forward } from "lucide-react";
import { useId, useRef, useState } from "react";
import { track } from "../lib/analytics";
import { loadSharePanel } from "./share-panel-loader";

export type ShareProps = {
  id: string;
  slug?: string | null;
  title: string;
  takeaway?: string | null;
  label?: string;
  placement?: string;
};

type SharePanelComponent = typeof import("./share-panel").SharePanel;

/** Keep dialog state and sharing code out of the initial feed bundle. */
export function ShareLinks(props: ShareProps) {
  const { id, title, label = "Share", placement = "feed" } = props;
  const [open, setOpen] = useState(false);
  const [Panel, setPanel] = useState<SharePanelComponent | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const loading = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  function loadPanel() {
    if (loading.current) return;
    loading.current = true;
    setLoadFailed(false);
    void loadSharePanel()
      .then(({ SharePanel }) => setPanel(() => SharePanel))
      .catch(() => setLoadFailed(true))
      .finally(() => {
        loading.current = false;
      });
  }

  return (
    <div
      className="share-menu"
      onKeyDown={(event) => {
        if (!Panel && open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
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
            if (!Panel) loadPanel();
          }
          setOpen(!open);
        }}
      >
        <Forward size={18} aria-hidden="true" /> {label}
      </button>
      {Panel ? (
        <Panel
          {...props}
          open={open}
          panelId={panelId}
          onClose={() => {
            setOpen(false);
            trigger.current?.focus();
          }}
        />
      ) : open ? (
        <div id={panelId}>
          <p className="share-load-status" role="status">
            {loadFailed ? "Sharing couldn’t load. Try again." : "Loading sharing options…"}
          </p>
          {loadFailed && (
            <button
              type="button"
              className="share-copy-post"
              onClick={() => {
                trigger.current?.focus();
                loadPanel();
              }}
            >
              Retry sharing
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

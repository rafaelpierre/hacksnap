"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import {
  ANALYTICS_CONSENT_REQUIRED,
  readAnalyticsConsent,
  setAnalyticsConsent,
  subscribeAnalyticsConsent,
} from "../lib/analytics-consent";

export function AnalyticsPreferences() {
  const consent = useSyncExternalStore(
    subscribeAnalyticsConsent,
    readAnalyticsConsent,
    () => "unknown",
  );
  const hydrated = useSyncExternalStore(
    subscribeAnalyticsConsent,
    () => true,
    () => false,
  );
  const [editing, setEditing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [failed, setFailed] = useState(false);
  const settings = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const visible =
    hydrated && (editing || (ANALYTICS_CONSENT_REQUIRED && consent === "unknown" && !dismissed));

  function choose(value: "accepted" | "declined") {
    const saved = setAnalyticsConsent(value);
    setFailed(!saved);
    if (!saved) return;
    setEditing(false);
    setDismissed(true);
    settings.current?.focus({ preventScroll: true });
  }

  return (
    <footer className="analytics-preferences-footer">
      <button
        ref={settings}
        type="button"
        className="analytics-preferences-settings"
        aria-expanded={visible}
        aria-controls="analytics-preferences"
        onClick={() => {
          setEditing(true);
          setFailed(false);
          requestAnimationFrame(() => panel.current?.focus());
        }}
      >
        Analytics preferences
      </button>
      <section
        ref={panel}
        id="analytics-preferences"
        hidden={!visible}
        className="analytics-preferences-panel ph-no-capture"
        tabIndex={-1}
        aria-labelledby="analytics-preferences-heading"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setEditing(false);
            setDismissed(true);
            settings.current?.focus();
          }
        }}
      >
        <h2 id="analytics-preferences-heading">Reading analytics</h2>
        <p>
          Allow Google Analytics and PostHog to measure reading journeys and sample masked session
          replay? Inputs and share drafts stay hidden. Change your choice anytime.
        </p>
        {editing && <p>Analytics are {consent === "accepted" ? "on" : "off"}.</p>}
        {failed && (
          <p role="status">Your browser could not save this choice. Analytics remain off.</p>
        )}
        <div className="analytics-preferences-actions">
          <button type="button" onClick={() => choose("accepted")}>
            Allow analytics
          </button>
          <button type="button" onClick={() => choose("declined")}>
            {consent === "accepted" ? "Turn analytics off" : "Decline analytics"}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDismissed(true);
                settings.current?.focus();
              }}
            >
              Close preferences
            </button>
          )}
        </div>
      </section>
    </footer>
  );
}

"use client";

type Event =
  | {name: "story_view"; story_id: string}
  | {name: "recommendation_exposure" | "recommendation_click"; story_id: string; target_story_id: string; placement: "read_next"}
  | {name: "share_menu_open"; story_id: string; placement: string}
  | {name: "share_destination_select"; story_id: string; destination: string; placement: string}
  | {name: "share_copy_success" | "share_copy_failure" | "share_manual_fallback"; story_id: string; copy_kind: "post" | "link"; placement: string}
  | {name: "return_visit"; observation_window_days: 30; days_since_visit_anchor: number};

declare global {
  interface Window { gtag?: (...args: unknown[]) => void; hacksnapPendingEvents?: Array<[string, Record<string, string | number>]> }
}

export function track(event: Event): void {
  if (typeof window === "undefined") return;
  try {
    const {name, ...parameters} = event;
    if (window.gtag) window.gtag("event", name, parameters);
    else (window.hacksnapPendingEvents ??= []).push([name, parameters]);
  } catch {
    // Analytics must never interrupt reading, navigation, or sharing.
  }
}

export function trackOnce(key: string, event: Event): void {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    const lastActivity = Number(sessionStorage.getItem("hacksnap:last-activity"));
    let session = sessionStorage.getItem("hacksnap:tracking-session");
    if (!session || !lastActivity || now - lastActivity > 30 * 60_000) {
      session = String(now);
      sessionStorage.setItem("hacksnap:tracking-session", session);
    }
    sessionStorage.setItem("hacksnap:last-activity", String(now));
    const eventKey = `hacksnap:event:${session}:${key}`;
    if (sessionStorage.getItem(eventKey)) return;
    sessionStorage.setItem(eventKey, "1");
  } catch {
    // Storage is optional. An extra event is preferable to breaking the site.
  }
  track(event);
}

export function recordVisit(now = Date.now()): void {
  if (typeof window === "undefined") return;
  try {
    const key = "hacksnap:visit-anchor";
    const anchor = Number(localStorage.getItem(key));
    const elapsed = now - anchor;
    if (anchor > 0 && elapsed >= 86_400_000 && elapsed <= 30 * 86_400_000) {
      trackOnce("return-visit", {name: "return_visit", observation_window_days: 30,
        days_since_visit_anchor: Math.floor(elapsed / 86_400_000)});
      localStorage.setItem(key, String(now));
    } else if (!anchor || elapsed < 0 || elapsed > 30 * 86_400_000) {
      // Keep the anchor across same-day loads; reset stale or invalid anchors.
      localStorage.setItem(key, String(now));
    }
  } catch {
    // Private browsing and blocked storage are supported.
  }
}

export async function copyShareText(text: string, storyId: string, placement: string, copyKind: "post" | "link",
  writeText: (value: string) => Promise<void> = value => navigator.clipboard.writeText(value)): Promise<boolean> {
  try {
    await writeText(text);
    track({name: "share_copy_success", story_id: storyId, copy_kind: copyKind, placement});
    return true;
  } catch {
    track({name: "share_copy_failure", story_id: storyId, copy_kind: copyKind, placement});
    track({name: "share_manual_fallback", story_id: storyId, copy_kind: copyKind, placement});
    return false;
  }
}

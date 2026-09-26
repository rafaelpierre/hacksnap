/** Versioned, content-free engagement events. GA supplies user/session/device identity. */
export type JourneyEvent = "reader_visit" | "story_view" | "recommendation_exposure" | "recommendation_click" | "share_menu_open" | "share_destination_select" | "share_copy_attempt" | "share_copy_success" | "share_copy_failure" | "share_manual_fallback" | "story_return" | "return_visit";
type Params = {placement?: string; observation_window_days?: 30; days_since_visit_anchor?: number; story_id?: string; target_story_id?: string; position?: number; destination?: string; copy_kind?: "link" | "post"};
type Sink = (name: JourneyEvent, params: Record<string, string | number>) => void;

/** Injectable state machine lets controlled journeys exercise deduplication without GA. */
export function createJourney(sink: Sink, makeId: () => string) {
  let path: string | undefined;
  let visitId = "";
  let seen = new Set<string>();
  function emit(name: JourneyEvent, params: Params = {}, once?: string) {
    if (once && seen.has(once)) return;
    if (once) seen.add(once);
    // Runtime allowlist: never forward drafts, titles, URLs or arbitrary caller fields.
    const safe: Record<string, string | number> = {contract_version: 2, visit_id: visitId};
    for (const key of ["story_id", "target_story_id", "position", "destination", "copy_kind", "placement", "observation_window_days", "days_since_visit_anchor"] as const) {
      const value = params[key];
      if (value !== undefined) safe[key] = value;
    }
    try { sink(name, safe); } catch { /* Analytics never interrupts an interaction. */ }
  }
  function route(nextPath: string) {
    if (path === nextPath) return;
    path = nextPath;
    visitId = makeId();
    seen = new Set();
    emit("reader_visit", {}, "visit");
  }
  return {route, emit};
}

type AnalyticsWindow = Window & {dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void};
const journey = createJourney((name, params) => {
  const win = window as AnalyticsWindow;
  // Preserve early events until the existing lazy GA script starts. No retry loop.
  if (typeof win.gtag === "function") win.gtag("event", name, params);
  else {
    win.dataLayer ??= [];
    function queue(..._args: unknown[]) { win.dataLayer!.push(arguments); }
    queue("event", name, params);
  }
}, () => globalThis.crypto.randomUUID());

type Event = Params & {name: JourneyEvent};

export function track(event: JourneyEvent | Event, params: Params = {}, once?: string) {
  const {name, ...fields} = typeof event === "string" ? {name: event, ...params} : event;
  if (typeof window === "undefined") return;
  try {
    journey.route(window.location.pathname);
    journey.emit(name, fields, once);
  } catch { /* Includes unavailable browser APIs and blocked analytics. */ }
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
  track({name: "share_copy_attempt", story_id: storyId, copy_kind: copyKind, placement});
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

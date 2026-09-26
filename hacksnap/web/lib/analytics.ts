/** Versioned, content-free engagement events. GA supplies user/session/device identity. */
export type JourneyEvent = "reader_visit" | "story_visit" | "recommendation_exposure" | "recommendation_click" | "share_open" | "share_destination" | "copy_attempt" | "copy_success" | "copy_failure" | "copy_manual_fallback" | "story_return";
type Params = {story_id?: string; target_story_id?: string; position?: number; destination?: string; copy_kind?: "link" | "post"};
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
    const safe: Record<string, string | number> = {contract_version: 1, visit_id: visitId};
    for (const key of ["story_id", "target_story_id", "position", "destination", "copy_kind"] as const) {
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

export function track(name: JourneyEvent, params: Params = {}, once?: string) {
  if (typeof window === "undefined") return;
  try {
    journey.route(window.location.pathname);
    journey.emit(name, params, once);
  } catch { /* Includes unavailable browser APIs and blocked analytics. */ }
}

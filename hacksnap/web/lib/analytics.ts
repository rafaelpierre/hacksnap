import { sendStoryEvent } from "./popularity-transport";
import type { ReadingContext, ReadingEvent, ReadingFields } from "./reading-contract";
import { analyticsAllowed, subscribeAnalyticsConsent } from "./analytics-consent";
import { captureVendorEvent, notifyAnalyticsReady } from "./analytics-vendors";
import { analyticsPageContext } from "./analytics-privacy";
import { beginAnalyticsPage, discardAnalyticsPage, setAnalyticsStory } from "./analytics-page";

/** Versioned, content-free engagement events. GA supplies user/session/device identity. */
export type JourneyEvent =
  | ReadingEvent
  | "reader_visit"
  | "story_view"
  | "story_click"
  | "recommendation_exposure"
  | "recommendation_click"
  | "share_menu_open"
  | "share_destination_select"
  | "share_copy_attempt"
  | "share_copy_success"
  | "share_copy_failure"
  | "share_manual_fallback"
  | "story_return"
  | "return_visit"
  | "home_story_open"
  | "home_feed_load"
  | "home_feed_end"
  | "feed_story_exposure"
  | "feed_load"
  | "feed_end"
  | "story_section_view"
  | "story_engagement"
  | "outbound_click";
export type JourneyParams = Partial<ReadingContext> &
  ReadingFields & {
    placement?: string;
    observation_window_days?: 30;
    days_since_visit_anchor?: number;
    story_id?: string;
    target_story_id?: string;
    position?: number;
    destination?: string;
    copy_kind?: "link" | "post";
    outcome?:
      | "success"
      | "empty"
      | "failure"
      | "expired"
      | "cancelled"
      | "exhausted"
      | "selection_limited";
    trigger?: "auto" | "manual";
    category_id?: string;
    section?: "summary" | "discussion" | "read_next";
    summary_state?: "ready" | "pending";
    active_seconds?: number;
    loaded_count?: number;
    feed_page?: number;
  };
type Sink = (name: JourneyEvent, params: Record<string, string | number>) => void;

/** Injectable state machine lets controlled journeys exercise deduplication without GA. */
export function createJourney(sink: Sink, makeId: () => string, firstPartySink?: Sink) {
  let path: string | undefined;
  let visitId = "";
  let seen = new Set<string>();
  function emitTo(
    id: string,
    deduplication: Set<string>,
    name: JourneyEvent,
    params: JourneyParams = {},
    once?: string,
    destination = sink,
  ) {
    if (once && deduplication.has(once)) return;
    if (once) deduplication.add(once);
    // Runtime allowlist: never forward drafts, titles, URLs or arbitrary caller fields.
    const safe: Record<string, string | number> = { contract_version: 3, visit_id: id };
    for (const key of [
      "story_id",
      "target_story_id",
      "position",
      "destination",
      "copy_kind",
      "placement",
      "observation_window_days",
      "days_since_visit_anchor",
      "outcome",
      "trigger",
      "category_id",
      "section",
      "summary_state",
      "active_seconds",
      "loaded_count",
      "feed_page",
      "reading_version",
      "content_revision",
      "layout_variant",
      "copy_variant",
      "category",
      "summary_status",
      "section_id",
      "section_type",
      "section_position",
      "section_words",
      "visible_ms",
      "active_ms",
      "last_section",
      "furthest_section",
      "checkpoint_reason",
      "checkpoint_sequence",
      "source_kind",
      "action",
    ] as const) {
      const value = params[key];
      if (value !== undefined) safe[key] = value;
    }
    try {
      firstPartySink?.(name, safe);
    } catch {
      /* Collection failures are independent of the GA sink. */
    }
    try {
      destination(name, safe);
    } catch {
      /* Analytics never interrupts an interaction. */
    }
  }
  function emit(name: JourneyEvent, params: JourneyParams = {}, once?: string) {
    emitTo(visitId, seen, name, params, once);
  }
  function capture(destination = sink) {
    const id = visitId;
    const deduplication = seen;
    return {
      visitId: id,
      emit: (name: JourneyEvent, params: JourneyParams = {}, once?: string) =>
        emitTo(id, deduplication, name, params, once, destination),
    };
  }
  function route(nextPath: string) {
    if (path === nextPath) return;
    const nextId = makeId();
    path = nextPath;
    visitId = nextId;
    seen = new Set();
    emit("reader_visit", {}, "visit");
  }
  return {
    route,
    emit,
    capture,
    visitId: () => visitId,
    reset() {
      path = undefined;
      seen.clear();
    },
  };
}

const firstParty = createJourney(
  (name, params) => {
    if ((name === "story_view" || name === "story_click") && typeof params.story_id === "string")
      sendStoryEvent({
        kind: name === "story_view" ? "view" : "click",
        story_id: params.story_id,
        visit_id: String(params.visit_id),
      });
  },
  () => globalThis.crypto.randomUUID(),
);
const vendors = createJourney(
  (name, params) => {
    const fields = { ...analyticsPageContext(), ...params };
    if (name === "reader_visit") beginAnalyticsPage(fields);
    if (name === "story_view") setAnalyticsStory(params);
    captureVendorEvent(name, fields);
  },
  () => globalThis.crypto.randomUUID(),
);
let currentStory: { route: string; params: JourneyParams } | undefined;
let currentWindow: Window | undefined;
let consentGeneration = 0;

type Event = JourneyParams & { name: JourneyEvent };

// Query-only navigation is a new route occurrence. Journey handoff tokens are
// transient; keep them out of the identity and never emit query values as fields.
export function analyticsRouteIdentity(pathname: string, search = ""): string {
  const query = new URLSearchParams(search);
  query.delete("journey");
  query.sort();
  const state = query.toString();
  return state ? `${pathname}?${state}` : pathname;
}

export function track(event: JourneyEvent | Event, params: JourneyParams = {}, once?: string) {
  const { name, ...fields } = typeof event === "string" ? { name: event, ...params } : event;
  if (typeof window === "undefined") return;
  try {
    if (currentWindow !== window) {
      currentWindow = window;
      currentStory = undefined;
      firstParty.reset();
      vendors.reset();
      discardAnalyticsPage();
    }
    const route = analyticsRouteIdentity(window.location.pathname, window.location.search);
    if (name === "story_view") currentStory = { route, params: fields };
    // Story query changes affect vendor visits, but do not reopen a story for
    // popularity. Preserve the existing pathname-based detail-view count.
    firstParty.route(
      window.location.pathname.startsWith("/story/") ? window.location.pathname : route,
    );
    firstParty.emit(name, fields, once);
    if (analyticsAllowed()) {
      vendors.route(route);
      vendors.emit(name, fields, once);
    }
  } catch {
    /* Includes unavailable browser APIs and blocked analytics. */
  }
}

export function startJourneyTracking() {
  let allowed = analyticsAllowed();
  const unsubscribe = subscribeAnalyticsConsent(() => {
    const next = analyticsAllowed();
    if (allowed === next) return;
    allowed = next;
    consentGeneration++;
    vendors.reset();
    discardAnalyticsPage();
    if (!analyticsAllowed()) return;
    const route = analyticsRouteIdentity(window.location.pathname, window.location.search);
    vendors.route(route);
    if (currentStory?.route === route)
      vendors.emit("story_view", currentStory.params, `story:${currentStory.params.story_id}`);
    recordVisit();
  });
  notifyAnalyticsReady();
  recordVisit();
  function resume(event: PageTransitionEvent) {
    if (!event.persisted) return;
    vendors.reset();
    track("reader_visit", {}, "visit");
    const route = analyticsRouteIdentity(window.location.pathname, window.location.search);
    if (analyticsAllowed() && currentStory?.route === route)
      vendors.emit("story_view", currentStory.params, `story:${currentStory.params.story_id}`);
  }
  window.addEventListener("pageshow", resume);
  return () => {
    unsubscribe();
    window.removeEventListener("pageshow", resume);
  };
}

/** Async outcomes belong to the route and consent epoch where the action began. */
export function prepareFeedLoadOutcome() {
  if (!analyticsAllowed()) return (_params: JourneyParams) => {};
  vendors.route(analyticsRouteIdentity(window.location.pathname, window.location.search));
  const generation = consentGeneration;
  const context = { ...analyticsPageContext(), contract_version: 3, visit_id: vendors.visitId() };
  let settled = false;
  return (params: JourneyParams) => {
    if (settled) return;
    settled = true;
    if (generation !== consentGeneration || !analyticsAllowed()) return;
    captureVendorEvent("feed_load", {
      ...context,
      trigger: params.trigger ?? "auto",
      outcome: params.outcome ?? "failure",
      loaded_count: params.loaded_count ?? 0,
      feed_page: params.feed_page ?? 1,
    });
  };
}

/** Bind section checkpoints to their original page and consent epoch. */
export function captureReadingVisit(context: ReadingContext) {
  if (typeof window === "undefined" || !analyticsAllowed()) return null;
  try {
    const page = analyticsPageContext();
    vendors.route(analyticsRouteIdentity(window.location.pathname, window.location.search));
    const captured = vendors.capture((name, fields) =>
      captureVendorEvent(name, { ...page, ...fields }),
    );
    const generation = consentGeneration;
    return {
      visitId: captured.visitId,
      emit(name: ReadingEvent, fields: ReadingFields = {}, once?: string) {
        if (generation !== consentGeneration || !analyticsAllowed()) return;
        captured.emit(
          name,
          { ...fields, ...context },
          once ? `reading:${context.content_revision}:${once}` : undefined,
        );
      },
    };
  } catch {
    return null;
  }
}

export function trackOnce(key: string, event: Event): void {
  if (typeof window === "undefined" || !analyticsAllowed()) return;
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
  if (typeof window === "undefined" || !analyticsAllowed()) return;
  try {
    const key = "hacksnap:visit-anchor";
    const anchor = Number(localStorage.getItem(key));
    const elapsed = now - anchor;
    if (anchor > 0 && elapsed >= 86_400_000 && elapsed <= 30 * 86_400_000) {
      trackOnce("return-visit", {
        name: "return_visit",
        observation_window_days: 30,
        days_since_visit_anchor: Math.floor(elapsed / 86_400_000),
      });
      localStorage.setItem(key, String(now));
    } else if (!anchor || elapsed < 0 || elapsed > 30 * 86_400_000) {
      // Keep the anchor across same-day loads; reset stale or invalid anchors.
      localStorage.setItem(key, String(now));
    }
  } catch {
    // Private browsing and blocked storage are supported.
  }
}

export async function copyShareText(
  text: string,
  storyId: string,
  placement: string,
  copyKind: "post" | "link",
  writeText: (value: string) => Promise<void> = (value) => navigator.clipboard.writeText(value),
): Promise<boolean> {
  track({ name: "share_copy_attempt", story_id: storyId, copy_kind: copyKind, placement });
  try {
    await writeText(text);
    track({ name: "share_copy_success", story_id: storyId, copy_kind: copyKind, placement });
    return true;
  } catch {
    track({ name: "share_copy_failure", story_id: storyId, copy_kind: copyKind, placement });
    track({ name: "share_manual_fallback", story_id: storyId, copy_kind: copyKind, placement });
    return false;
  }
}

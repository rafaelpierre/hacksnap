import { analyticsAllowed } from "./analytics-consent";
import { captureVendorEvent } from "./analytics-vendors";
import { analyticsPageContext } from "./analytics-privacy";

type Fields = Record<string, string | number>;

export function createActiveClock(now: number) {
  let last = now;
  let input = now;
  let active = 0;
  let foreground = true;
  return {
    update(time: number, visible: boolean, interacted = false) {
      if (foreground) active += Math.max(0, Math.min(time, input + 60_000) - last);
      last = time;
      foreground = visible;
      if (interacted) input = time;
      return Math.floor(active / 1000);
    },
  };
}

let state:
  | {
      fields: Fields;
      started: number;
      clock: ReturnType<typeof createActiveClock>;
      scroll: number;
      story?: Fields;
      sentSeconds?: number;
    }
  | undefined;
let observedWindow: Window | undefined;

function foreground() {
  return document.visibilityState === "visible" && document.hasFocus();
}

function snapshot(interacted = false) {
  if (!state || !analyticsAllowed()) return;
  const seconds = state.clock.update(Date.now(), foreground(), interacted);
  const height = Math.max(document.documentElement.scrollHeight, window.innerHeight);
  state.scroll = Math.max(
    state.scroll,
    Math.min(1, (window.scrollY + window.innerHeight) / height),
  );
  return seconds;
}

function progress() {
  const seconds = snapshot();
  if (state?.story && seconds !== undefined && seconds !== state.sentSeconds) {
    state.sentSeconds = seconds;
    captureVendorEvent("story_engagement", {
      ...state.fields,
      ...state.story,
      active_seconds: seconds,
    });
  }
}

export function finishAnalyticsPage() {
  if (!state) return;
  progress();
  if (analyticsAllowed())
    captureVendorEvent("$pageleave", {
      ...state.fields,
      $prev_pageview_duration: Math.max(0, (Date.now() - state.started) / 1000),
      $prev_pageview_max_scroll_percentage: state.scroll,
      $prev_pageview_max_content_percentage: state.scroll,
    });
  state = undefined;
}

export function discardAnalyticsPage() {
  state = undefined;
}

export function beginAnalyticsPage(fields: Fields) {
  finishAnalyticsPage();
  if (!analyticsAllowed()) return;
  const now = Date.now();
  state = {
    fields: { ...analyticsPageContext(), ...fields },
    started: now,
    clock: createActiveClock(now),
    scroll: 0,
  };
  snapshot();
  captureVendorEvent("$pageview", state.fields);
  if (observedWindow === window) return;
  observedWindow = window;
  for (const event of ["pointerdown", "keydown", "scroll"])
    window.addEventListener(
      event,
      () => {
        snapshot(true);
      },
      { passive: true },
    );
  window.addEventListener("focus", () => {
    snapshot(true);
  });
  window.addEventListener("blur", progress);
  document.addEventListener("visibilitychange", progress);
  window.addEventListener("pagehide", finishAnalyticsPage);
  window.setInterval(progress, 15_000);
}

export function setAnalyticsStory(fields: Fields) {
  if (state) state.story = fields;
}

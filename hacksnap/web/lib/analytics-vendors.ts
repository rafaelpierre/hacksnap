import { analyticsAllowed, subscribeAnalyticsConsent } from "./analytics-consent";
import { analyticsPageContext } from "./analytics-privacy";
import { posthogHost } from "./posthog-host";

export const GA_ID = "G-059PVYBN82";
const READY_EVENT = "hacksnap:analytics-ready";
const CAPTURE_EVENT = "hacksnap:analytics-capture";
type Properties = Record<string, string | number>;
type Client = { capture: (name: string, properties: Properties) => void; stop: () => void };
type AnalyticsWindow = Window & { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
let client: Client | undefined;
let pending: Array<{ name: string; properties: Properties }> = [];
let loading = false;
let generation = 0;
let hydrated = false;
let installed = false;

export function posthogConfigured(): boolean {
  return (
    process.env.NEXT_PUBLIC_POSTHOG_ENABLED === "true" &&
    !!process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN &&
    !!posthogHost()
  );
}

function googleTag(): (...args: unknown[]) => void {
  const win = window as AnalyticsWindow;
  if (!win.gtag) {
    win.dataLayer ??= [];
    win.gtag = function (..._args: unknown[]) {
      win.dataLayer!.push(arguments);
    };
    win.gtag("js", new Date());
    win.gtag("config", GA_ID, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: analyticsPageContext().$current_url,
      page_referrer: analyticsPageContext().$referrer,
      page_title: "Hacksnap",
    });
  }
  return win.gtag;
}

function loadGoogle() {
  if (!analyticsAllowed()) return;
  googleTag();
  if (document.getElementById("hacksnap-google-analytics")) return;
  const script = document.createElement("script");
  script.id = "hacksnap-google-analytics";
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(script);
}

export function captureVendorEvent(name: string, properties: Properties) {
  if (!analyticsAllowed()) return;
  try {
    const context = analyticsPageContext();
    googleTag()(
      "event",
      name === "$pageview" ? "page_view" : name === "$pageleave" ? "page_leave" : name,
      {
        ...properties,
        page_location: properties.$current_url ?? context.$current_url,
        page_referrer: context.$referrer,
        page_title: "Hacksnap",
      },
    );
  } catch {
    /* Vendor failures cannot affect each other or the reader. */
  }
  if (!posthogConfigured()) return;
  // Next's instrumentation and React entries can have separate module state.
  // A document event crosses that boundary without exposing the vendor client.
  window.dispatchEvent(new window.CustomEvent(CAPTURE_EVENT, { detail: { name, properties } }));
}

function capturePostHog(name: string, properties: Properties) {
  if (!analyticsAllowed()) return;
  if (client) {
    try {
      client.capture(name, properties);
    } catch {
      /* Best effort. */
    }
  } else if (pending.length < 200) {
    pending.push({ name, properties });
  }
}

async function initialize() {
  if (!hydrated || !analyticsAllowed()) return;
  (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = false;
  // Preserve passive-visit coverage whenever the current preference allows analytics.
  loadGoogle();
  if (!posthogConfigured() || client || loading) return;
  const epoch = generation;
  loading = true;
  try {
    const { createPostHogClient } = await import("./posthog-client");
    if (epoch !== generation || !analyticsAllowed()) return;
    client = createPostHogClient();
    const queued = pending;
    pending = [];
    for (const event of queued) {
      if (!analyticsAllowed()) break;
      client.capture(event.name, event.properties);
    }
  } catch {
    pending = [];
  } finally {
    if (epoch === generation) loading = false;
  }
}

function clearAnalyticsStorage() {
  for (const store of [() => window.localStorage, () => window.sessionStorage]) {
    try {
      const storage = store();
      for (const key of Object.keys(storage)) {
        if (
          /^(ph_|__ph_|hacksnap:(analytics-first-session|analytics-landing|visit-anchor|last-activity|tracking-session|event:))/.test(
            key,
          )
        )
          storage.removeItem(key);
      }
    } catch {
      /* Storage may be unavailable. */
    }
  }
  const host = window.location.hostname.split(".");
  const domains = ["", ...host.map((_, index) => `; domain=.${host.slice(index).join(".")}`)];
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0].trim();
    if (!/^(_ga|_gid|_gat|ph_|__ph_)/.test(name)) continue;
    for (const domain of domains)
      document.cookie = `${name}=; Max-Age=0; path=/${domain}; SameSite=Lax`;
  }
}

function stop() {
  generation++;
  loading = false;
  pending = [];
  (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = true;
  const win = window as AnalyticsWindow;
  win.dataLayer?.splice(0);
  win.dataLayer = [];
  delete win.gtag;
  document.getElementById("hacksnap-google-analytics")?.remove();
  try {
    client?.stop();
  } finally {
    client = undefined;
    clearAnalyticsStorage();
  }
}

export function notifyAnalyticsReady() {
  window.dispatchEvent(new window.Event(READY_EVENT));
}

export function installAnalyticsRuntime() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener(CAPTURE_EVENT, (event) => {
    const { name, properties } = (event as CustomEvent<{ name: string; properties: Properties }>)
      .detail;
    capturePostHog(name, properties);
  });
  window.addEventListener(READY_EVENT, () => {
    hydrated = true;
    void initialize();
  });
  subscribeAnalyticsConsent(() => {
    if (analyticsAllowed()) void initialize();
    else stop();
  });
  if (!analyticsAllowed()) stop();
}

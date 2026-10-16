export const ANALYTICS_CONSENT_KEY = "hacksnap:analytics-consent:v1";
export const ANALYTICS_CONSENT_EVENT = "hacksnap:analytics-consent";
// Set to true at build time to restore the automatic banner and explicit opt-in.
export const ANALYTICS_CONSENT_REQUIRED =
  process.env.NEXT_PUBLIC_ANALYTICS_REQUIRE_CONSENT === "true";
export type AnalyticsConsent = "accepted" | "declined" | "unknown";
type ConsentWindow = Window & { __hacksnapAnalyticsStorageFailed?: boolean };

export function readAnalyticsConsent(): AnalyticsConsent {
  try {
    if ((window as ConsentWindow).__hacksnapAnalyticsStorageFailed) return "unknown";
    const value = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
    if (value === "accepted" || value === "declined") return value;
    return ANALYTICS_CONSENT_REQUIRED ? "unknown" : "accepted";
  } catch {
    return "unknown";
  }
}

export function analyticsAllowed(): boolean {
  return readAnalyticsConsent() === "accepted";
}

export function setAnalyticsConsent(value: Exclude<AnalyticsConsent, "unknown">): boolean {
  let saved = false;
  try {
    window.localStorage.setItem(ANALYTICS_CONSENT_KEY, value);
    (window as ConsentWindow).__hacksnapAnalyticsStorageFailed = false;
    saved = readAnalyticsConsent() === value;
  } catch {
    (window as ConsentWindow).__hacksnapAnalyticsStorageFailed = true;
    // A choice we cannot persist must never turn collection on.
  }
  window.dispatchEvent(new window.Event(ANALYTICS_CONSENT_EVENT));
  return saved;
}

export function subscribeAnalyticsConsent(listener: () => void): () => void {
  function storage(event: StorageEvent) {
    if (event.key === ANALYTICS_CONSENT_KEY || event.key === null) listener();
  }
  window.addEventListener(ANALYTICS_CONSENT_EVENT, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(ANALYTICS_CONSENT_EVENT, listener);
    window.removeEventListener("storage", storage);
  };
}

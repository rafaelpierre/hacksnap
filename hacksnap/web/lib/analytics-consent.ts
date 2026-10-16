export const ANALYTICS_CONSENT_KEY = "hacksnap:analytics-consent:v1";
export const ANALYTICS_CONSENT_EVENT = "hacksnap:analytics-consent";
export type AnalyticsConsent = "accepted" | "declined" | "unknown";
type ConsentWindow = Window & { __hacksnapAnalyticsStorageFailed?: boolean };

export function readAnalyticsConsent(): AnalyticsConsent {
  try {
    if ((window as ConsentWindow).__hacksnapAnalyticsStorageFailed) return "unknown";
    const value = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return value === "accepted" || value === "declined" ? value : "unknown";
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

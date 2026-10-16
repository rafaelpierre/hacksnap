import { JSDOM } from "jsdom";

export function analyticsBrowser(url = "https://hacksnap.live/", consent = "accepted") {
  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { url });
  const keys = ["window", "document", "navigator", "localStorage", "sessionStorage"];
  const previous = new Map(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const key of keys)
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: dom.window[key],
      writable: true,
    });
  if (consent) window.localStorage.setItem("hacksnap:analytics-consent:v1", consent);
  return () => {
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  };
}

import { categoryBySlug } from "./categories";

export function publicAnalyticsURL(value: string, base = "https://hacksnap.live"): string {
  if (!value) return "";
  try {
    const url = new URL(value, base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

export function referrerOrigin(value: string): string {
  if (!value || value === "$direct") return "";
  try {
    return new URL(publicAnalyticsURL(value)).origin;
  } catch {
    return "";
  }
}

export function analyticsPageContext() {
  const path = window.location.pathname;
  const query = new URLSearchParams(window.location.search);
  const category = categoryBySlug(query.get("category") ?? "");
  const page = Number(query.get("page") ?? 1);
  return {
    $current_url: publicAnalyticsURL(window.location.href),
    $pathname: path,
    $referrer: referrerOrigin(document.referrer),
    $referring_domain: referrerOrigin(document.referrer).replace(/^https?:\/\//, "") || "$direct",
    route_type: path.startsWith("/story/")
      ? "story"
      : path === "/"
        ? "feed"
        : path === "/topics"
          ? "topics"
          : /^\/\d{4}\/\d{2}$/.test(path)
            ? "archive"
            : "other",
    ...(category ? { category_id: category.id } : {}),
    ...(Number.isSafeInteger(page) && page > 0 && page <= 10000 ? { feed_page: page } : {}),
    layout_version: "2026-10",
    app: "hacksnap",
  };
}

/** Scrub SDK-generated properties too, including nested web-vitals payloads. */
export function scrubAnalyticsProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    // Heatmaps index points by raw URL, rather than storing URLs as values.
    // Enforce the initial three rules locally as well as in project settings.
    if (key === "$heatmap_data" && value && typeof value === "object") {
      const maps: Record<string, unknown[]> = {};
      for (const [rawURL, points] of Object.entries(value)) {
        const url = publicAnalyticsURL(rawURL);
        if (!url || !Array.isArray(points)) continue;
        const path = new URL(url).pathname;
        if (path !== "/" && path !== "/topics" && !/^\/story\/[^/]+\/?$/.test(path)) continue;
        (maps[url] ??= []).push(...points);
      }
      safe[key] = maps;
      continue;
    }
    if (
      /utm_|gclid|fbclid|msclkid|campaign|title|\$search|\$hash|\$raw|\$el_text|attr__|\$elements_chain/i.test(
        key,
      )
    )
      continue;
    if (/referrer/i.test(key) && typeof value === "string") safe[key] = referrerOrigin(value);
    else if (/url|href/i.test(key) && typeof value === "string")
      safe[key] = publicAnalyticsURL(value);
    else if (/pathname/i.test(key) && typeof value === "string") safe[key] = value.split(/[?#]/)[0];
    else if (Array.isArray(value))
      safe[key] = value.map((item) =>
        item && typeof item === "object" ? scrubAnalyticsProperties(item) : item,
      );
    else if (value && typeof value === "object")
      safe[key] = scrubAnalyticsProperties(value as Record<string, unknown>);
    else safe[key] = value;
  }
  return safe;
}

export function maskReplayAttribute(name: string, value: string): string {
  if (/^(href|src|action|poster|xlink:href)$/i.test(name)) return publicAnalyticsURL(value);
  if (/^(value|srcset|data-.*|on.*)$/i.test(name)) return "";
  return value;
}

export function articleURL(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (["news.ycombinator.com", "www.news.ycombinator.com"].includes(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function domain(value: string): string {
  const safe = articleURL(value);
  return safe ? new URL(safe).hostname.replace(/^www\./, "") : "Hacker News";
}

export function timestamp(value: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }).format(new Date(value)) + " UTC";
}

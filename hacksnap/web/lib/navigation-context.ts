import { categoryBySlug, categoryURL } from "./categories.ts";
import { archivePage, monthLabel } from "./archive.ts";

export type BrowseContext = { url: string; label: string; scrollY: number; savedAt: number };

const MAX_AGE_MS = 8 * 60 * 60 * 1000;

export function browseLabel(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, "https://hacksnap.invalid");
  } catch {
    return null;
  }
  if (parsed.origin !== "https://hacksnap.invalid" || parsed.hash) return null;
  const params = [...parsed.searchParams.keys()];
  if (
    params.some((key) => !["page", "category"].includes(key)) ||
    new Set(params).size !== params.length
  )
    return null;
  const page = parsed.searchParams.get("page");
  if (archivePage(page ?? undefined) === null) return null;
  const slug = parsed.searchParams.get("category");
  const selected = slug === null ? null : categoryBySlug(slug);
  if (slug !== null && (!selected || parsed.pathname !== "/")) return null;
  if (parsed.pathname === "/") {
    if (selected) return `${selected.label}${page && page !== "1" ? ` · page ${page}` : ""}`;
    return page && page !== "1" ? `Latest stories · page ${page}` : "Latest stories";
  }
  const pageSuffix = page && page !== "1" ? ` · page ${page}` : "";
  const archive = /^\/([1-9]\d{3})\/(0[1-9]|1[0-2])$/.exec(parsed.pathname);
  if (archive) return `${monthLabel(`${archive[1]}-${archive[2]}`)} archive${pageSuffix}`;
  const match = /^\/category\/([a-z-]+)$/.exec(parsed.pathname);
  const category = match && categoryBySlug(match[1]);
  return category ? `${category.label}${pageSuffix}` : null;
}

// Migrate only validated legacy category destinations; page and topic isolation
// still apply to every stored context and feed snapshot.
export function normalizedBrowseURL(url: string): string | null {
  if (!url.startsWith("/") || url.startsWith("//") || !browseLabel(url)) return null;
  const parsed = new URL(url, "https://hacksnap.invalid");
  const match = /^\/category\/([a-z-]+)$/.exec(parsed.pathname);
  const category = match && categoryBySlug(match[1]);
  return category
    ? categoryURL(category, archivePage(parsed.searchParams.get("page") ?? undefined)!)
    : url;
}

export function validBrowseContext(value: unknown, now = Date.now()): BrowseContext | null {
  if (!value || typeof value !== "object") return null;
  const context = value as Partial<BrowseContext>;
  if (
    typeof context.url !== "string" ||
    !context.url.startsWith("/") ||
    context.url.startsWith("//")
  )
    return null;
  const label = browseLabel(context.url);
  if (
    !label ||
    context.label !== label ||
    typeof context.savedAt !== "number" ||
    now < context.savedAt ||
    now - context.savedAt > MAX_AGE_MS
  )
    return null;
  if (
    typeof context.scrollY !== "number" ||
    !Number.isFinite(context.scrollY) ||
    context.scrollY < 0
  )
    return null;
  const url = normalizedBrowseURL(context.url);
  if (!url) return null;
  return { url, label: browseLabel(url)!, scrollY: context.scrollY, savedAt: context.savedAt };
}

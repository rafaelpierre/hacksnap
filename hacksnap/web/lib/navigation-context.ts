import { categoryBySlug } from "./categories.ts";
import { monthLabel } from "./archive.ts";

export type BrowseContext = { url: string; label: string; scrollY: number; savedAt: number };

const MAX_AGE_MS = 8 * 60 * 60 * 1000;

export function browseLabel(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url, "https://hacksnap.invalid"); } catch { return null; }
  if (parsed.origin !== "https://hacksnap.invalid" || parsed.hash) return null;
  const params = [...parsed.searchParams.keys()];
  if (params.some(key => key !== "page") || params.filter(key => key === "page").length > 1) return null;
  const page = parsed.searchParams.get("page");
  if (page !== null && (!/^[1-9][0-9]*$/.test(page) || Number(page) > 10000)) return null;
  if (parsed.pathname === "/") return page ? null : "Top stories";
  const pageSuffix = page && page !== "1" ? ` · page ${page}` : "";
  if (parsed.pathname === "/archive") return `Latest stories${pageSuffix}`;
  const archive = /^\/archive\/([1-9]\d{3})\/(0[1-9]|1[0-2])$/.exec(parsed.pathname);
  if (archive) return `${monthLabel(`${archive[1]}-${archive[2]}`)} archive${pageSuffix}`;
  const match = /^\/category\/([a-z-]+)$/.exec(parsed.pathname);
  const category = match && categoryBySlug(match[1]);
  return category ? `${category.label}${pageSuffix}` : null;
}

export function validBrowseContext(value: unknown, now = Date.now()): BrowseContext | null {
  if (!value || typeof value !== "object") return null;
  const context = value as Partial<BrowseContext>;
  if (typeof context.url !== "string" || !context.url.startsWith("/") || context.url.startsWith("//")) return null;
  const label = browseLabel(context.url);
  if (!label || context.label !== label || typeof context.savedAt !== "number" || now < context.savedAt || now - context.savedAt > MAX_AGE_MS) return null;
  if (typeof context.scrollY !== "number" || !Number.isFinite(context.scrollY) || context.scrollY < 0) return null;
  return {url: context.url, label, scrollY: context.scrollY, savedAt: context.savedAt};
}

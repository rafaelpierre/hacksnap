import { validFeedPage } from "./feed-state";

export async function fetchFeedPage(listingPath: string, nextPage: number, signal: AbortSignal) {
  const query = new URLSearchParams({
    path: listingPath,
    page: String(nextPage),
  });
  const response = await fetch(`/api/browse-stories?${query}`, {
    signal,
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Story load failed");
  const page = validFeedPage(await response.json(), listingPath);
  if (!page || page.pagination.page !== nextPage) throw new Error("Invalid story page");
  return page;
}

export function openStoryDocument(href: string, token: string | null): boolean {
  const { userAgent, platform, maxTouchPoints } = window.navigator;
  const ios = /iPad|iPhone|iPod/.test(userAgent) || (platform === "MacIntel" && maxTouchPoints > 1);
  if (!ios) return false;
  // WebKit can skip pushState entries created after an async navigation outlives
  // the tap's user activation. Start a document navigation during the tap instead.
  const url = new URL(href, window.location.origin);
  if (token) url.searchParams.set("journey", token);
  window.location.assign(url.pathname + url.search + url.hash);
  return true;
}

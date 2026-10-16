export function posthogHost(): string | undefined {
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;
  if (host === "https://eu.i.posthog.com" || host === "https://relay.hacksnap.live") return host;
  return undefined;
}

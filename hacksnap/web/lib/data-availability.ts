import { unstable_noStore as noStore } from "next/cache";

export class DataUnavailableError extends Error {
  constructor() {
    super("Hacksnap data is temporarily unavailable");
    this.name = "DataUnavailableError";
  }
}

// Preserve empty results and missing records as successful reads. Only outages
// opt out of caching; programming errors and Next routing signals still propagate.
export async function availableData<T>(
  load: () => Promise<T>,
): Promise<{ available: true; value: T } | { available: false }> {
  try {
    return { available: true, value: await load() };
  } catch (error) {
    if (!(error instanceof DataUnavailableError)) throw error;
    noStore();
    return { available: false };
  }
}

export function unavailableResponse() {
  return new Response("Stories are temporarily unavailable", {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Retry-After": "60",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

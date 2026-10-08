import { cache } from "react";

// React scopes this registry to one server render, never across requests.
const primaryReads = cache(() => new Set<Promise<unknown>>());

export async function readPrimaryContent<T>(read: () => Promise<T>): Promise<T> {
  const pending = primaryReads();
  const result = read();
  pending.add(result);
  try {
    return await result;
  } finally {
    pending.delete(result);
  }
}

export async function waitForPrimaryContent() {
  const pending = primaryReads();
  // A sibling route registers synchronously, before its first await. Let it
  // finish validation and required reads before optional queries use the pool.
  // Routing signals still propagate from the route; they must not reject here.
  while (pending.size) await Promise.allSettled(pending);
}

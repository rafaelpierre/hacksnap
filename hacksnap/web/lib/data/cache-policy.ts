import "server-only";
import { pendingBudget } from "../bounded-cache";

// Every read, including uncached exports, acquires this before joining a pool.
export const readWorkload = pendingBudget(8);
const browseLimits = { maxPending: 8 };

// Hard expiry and per-cache cardinality stay independent of the shared read budget.
export const cachePolicy = {
  selection: { ttl: () => 60_000, maxEntries: 1, maxPending: 1 },
  freshSelection: { ttl: () => 10_000, maxEntries: 1, maxPending: 1 },
  snapshotPage: { ttl: () => 60_000, maxEntries: 64, maxPending: 8 },
  feed: { ttl: () => 300_000, maxEntries: 1, maxPending: 1 },
  markdownHistory: { ttl: () => 60_000, maxEntries: 2, maxPending: 1 },
  popular: { ttl: () => 300_000, maxEntries: 2, maxPending: 2 },
  story: { ttl: (story: unknown) => (story ? 1_800_000 : 60_000), maxEntries: 128, maxPending: 4 },
  metrics: {
    ttl: (metrics: unknown) => (metrics ? 1_800_000 : 60_000),
    maxEntries: 128,
    maxPending: 4,
  },
  months: {
    ttl: (months: unknown[]) => (months.length ? 300_000 : 30_000),
    maxEntries: 1,
    ...browseLimits,
  },
  counts: {
    ttl: (counts: object) => (Object.keys(counts).length ? 300_000 : 30_000),
    maxEntries: 1,
    ...browseLimits,
  },
  browse: {
    ttl: (result: { stories: unknown[] }) => (result.stories.length ? 60_000 : 30_000),
    maxEntries: 128,
    ...browseLimits,
  },
  related: {
    ttl: (stories: unknown[]) => (stories.length ? 60_000 : 30_000),
    maxEntries: 128,
    ...browseLimits,
  },
};

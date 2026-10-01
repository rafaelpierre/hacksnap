// A budget can be shared by several caches backed by the same scarce resource.
// Acquiring is synchronous, before a load can enter the database pool queue.
export function pendingBudget(maxPending: number) {
  let pending = 0;
  return {
    acquire() {
      if (pending >= maxPending) return false;
      pending++;
      return true;
    },
    release() {
      pending--;
    },
  };
}

type PendingBudget = ReturnType<typeof pendingBudget>;

// Per-instance LRU with hard expiry and same-key request coalescing. Rejections
// are never retained. Limits include pending loads, so random IDs cannot grow
// memory or the database wait queue without bound.
export function boundedCache<T>(
  load: (key: string) => Promise<T>,
  options: {
    ttl: (value: T) => number;
    maxEntries: number;
    maxPending: number;
    pendingBudget?: PendingBudget;
    now?: () => number;
  },
): (key: string) => Promise<T> {
  const entries = new Map<string, { promise: Promise<T>; expires: number; pending: boolean }>();
  const now = options.now ?? (() => Date.now());
  let pending = 0;
  return async (key) => {
    const existing = entries.get(key);
    if (existing && (existing.pending || existing.expires > now())) {
      entries.delete(key);
      entries.set(key, existing);
      return existing.promise;
    }
    entries.delete(key);
    if (pending >= options.maxPending) throw new Error("Public data is busy");
    const oldest =
      entries.size >= options.maxEntries
        ? [...entries].find(([, entry]) => !entry.pending)
        : undefined;
    if (entries.size >= options.maxEntries && !oldest) throw new Error("Public data is busy");
    if (options.pendingBudget && !options.pendingBudget.acquire())
      throw new Error("Public data is busy");
    if (oldest) entries.delete(oldest[0]);
    pending++;
    const entry = { promise: Promise.resolve().then(() => load(key)), expires: 0, pending: true };
    entries.set(key, entry);
    try {
      const value = await entry.promise;
      entry.expires = now() + options.ttl(value);
      return value;
    } catch (error) {
      entries.delete(key);
      throw error;
    } finally {
      entry.pending = false;
      pending--;
      options.pendingBudget?.release();
    }
  };
}

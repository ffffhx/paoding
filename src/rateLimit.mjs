export function createSlidingWindowRateLimiter({ limit = 20, windowMs = 60_000, now = () => Date.now() } = {}) {
  const buckets = new Map();
  const max = Number(limit);
  const span = Math.max(1000, Number(windowMs) || 60_000);

  return {
    take(key) {
      if (!Number.isFinite(max) || max <= 0) return { allowed: true, remaining: Infinity, resetMs: 0 };
      const t = now();
      const cutoff = t - span;
      const hits = (buckets.get(key) || []).filter((x) => x > cutoff);
      if (hits.length >= max) {
        buckets.set(key, hits);
        return { allowed: false, remaining: 0, resetMs: Math.max(0, hits[0] + span - t) };
      }
      hits.push(t);
      buckets.set(key, hits);
      return { allowed: true, remaining: max - hits.length, resetMs: Math.max(0, hits[0] + span - t) };
    },
    clear() {
      buckets.clear();
    },
  };
}

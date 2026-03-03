/**
 * Simple in-memory per-IP rate limiter.
 *
 * Note: This is per-process / per-container. In a multi-instance deployment
 * (e.g. multiple containers behind a load balancer), a shared store like
 * Redis would be needed for consistent rate limiting across instances.
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 20; // 20 requests per minute per identifier

const store = new Map<string, RateLimitEntry>();

// Periodic cleanup to prevent memory leak from stale entries
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now > entry.resetTime) {
        store.delete(key);
      }
    }
  }, WINDOW_MS).unref?.();
}

export function checkRateLimit(identifier: string): {
  allowed: boolean;
  retryAfterMs?: number;
} {
  const now = Date.now();
  const entry = store.get(identifier);

  if (!entry || now > entry.resetTime) {
    store.set(identifier, { count: 1, resetTime: now + WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= MAX_REQUESTS) {
    return { allowed: false, retryAfterMs: entry.resetTime - now };
  }

  entry.count++;
  return { allowed: true };
}

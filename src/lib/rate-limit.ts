/**
 * Lightweight in-memory rate limiter for failed authentication attempts.
 * Works in both Node and Edge runtimes.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const DEFAULT_MAX_ATTEMPTS = 10;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_KEYS = 2000;

export interface RateLimitOptions {
  maxAttempts?: number;
  windowMs?: number;
  now?: number;
}

const buckets = new Map<string, Bucket>();

export function checkAuthRateLimit(
  key: string,
  options: RateLimitOptions = {}
): { allowed: boolean; retryAfterSeconds: number } {
  const now = options.now ?? Date.now();
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (bucket) buckets.delete(key);
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (bucket.count >= maxAttempts) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordAuthFailure(
  key: string,
  options: RateLimitOptions = {}
): void {
  const now = options.now ?? Date.now();
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  pruneExpired(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  existing.count += 1;
}

export function clearAuthFailures(key: string): void {
  buckets.delete(key);
}

export function resetAllAuthRateLimits(): void {
  buckets.clear();
}

export function extractClientKey(headers: {
  get(name: string): string | null;
}): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "local";
}

function pruneExpired(now: number) {
  if (buckets.size < MAX_TRACKED_KEYS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // If still full, evict oldest entries.
  while (buckets.size >= MAX_TRACKED_KEYS) {
    const oldest = buckets.keys().next().value;
    if (oldest === undefined) break;
    buckets.delete(oldest);
  }
}

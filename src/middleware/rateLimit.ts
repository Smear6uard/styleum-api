import type { Context, Next } from "hono";

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyGenerator?: (c: Context) => string;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean every minute

export function createRateLimiter(options: RateLimitOptions) {
  const { windowMs, max, keyGenerator } = options;

  return async (c: Context, next: Next) => {
    const key = keyGenerator ? keyGenerator(c) : c.req.header("x-forwarded-for") ?? "anonymous";
    const now = Date.now();

    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetTime < now) {
      entry = {
        count: 0,
        resetTime: now + windowMs,
      };
    }

    entry.count++;
    rateLimitStore.set(key, entry);

    const remaining = Math.max(0, max - entry.count);
    const resetSeconds = Math.ceil((entry.resetTime - now) / 1000);

    c.header("X-RateLimit-Limit", max.toString());
    c.header("X-RateLimit-Remaining", remaining.toString());
    c.header("X-RateLimit-Reset", resetSeconds.toString());

    if (entry.count > max) {
      return c.json(
        {
          error: "Too many requests",
          retryAfter: resetSeconds,
        },
        429
      );
    }

    await next();
  };
}

// Preset rate limiters

// 30 requests per hour for item uploads
export const itemUploadLimit = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30,
  keyGenerator: (c) => {
    const userId = c.get("userId") as string | undefined;
    return userId ? `item-upload:${userId}` : `item-upload:${c.req.header("x-forwarded-for") ?? "anonymous"}`;
  },
});

// 75 requests per day for Style Me
export const styleMeLimit = createRateLimiter({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 75,
  keyGenerator: (c) => {
    const userId = c.get("userId") as string | undefined;
    return userId ? `style-me:${userId}` : `style-me:${c.req.header("x-forwarded-for") ?? "anonymous"}`;
  },
});

import type { Context, Next } from "hono";
import { supabaseAdmin, isUserPro } from "../services/supabase.js";

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

// ============================================================================
// MONTHLY STYLE ME LIMITS (Database-based)
// ============================================================================

// Free: 5 generations/month, Pro: 75 generations/month
const FREE_MONTHLY_LIMIT = 5;
const PRO_MONTHLY_LIMIT = 75;

export interface StyleMeLimitCheck {
  allowed: boolean;
  remaining: number;
  used: number;
  limit: number;
  resetsAt: Date;
  isPro: boolean;
}

/**
 * Check Style Me monthly generation limit from database
 */
export async function checkStyleMeLimit(userId: string): Promise<StyleMeLimitCheck> {
  const isPro = await isUserPro(userId);
  const limit = isPro ? PRO_MONTHLY_LIMIT : FREE_MONTHLY_LIMIT;

  // Get current month's start and end
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // Count generations this month
  const { count, error } = await supabaseAdmin
    .from("generated_outfits")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("generated_at", monthStart.toISOString())
    .lt("generated_at", monthEnd.toISOString());

  if (error) {
    console.error("[RateLimit] Failed to check style me limit:", error);
    // Fail open - allow the request but log the error
    return {
      allowed: true,
      remaining: limit,
      used: 0,
      limit,
      resetsAt: monthEnd,
      isPro,
    };
  }

  const used = count || 0;
  const remaining = Math.max(0, limit - used);

  return {
    allowed: remaining > 0,
    remaining,
    used,
    limit,
    resetsAt: monthEnd,
    isPro,
  };
}

/**
 * Middleware for Style Me generation endpoint
 * Uses database-based monthly limits (Free: 5/mo, Pro: 75/mo)
 */
export async function styleMeLimitMiddleware(
  c: Context<{ Variables: { userId: string } }>,
  next: Next
) {
  const userId = c.get("userId");
  const limitCheck = await checkStyleMeLimit(userId);

  // Set rate limit headers
  c.header("X-RateLimit-Limit", limitCheck.limit.toString());
  c.header("X-RateLimit-Remaining", limitCheck.remaining.toString());
  c.header("X-RateLimit-Reset", limitCheck.resetsAt.toISOString());

  if (!limitCheck.allowed) {
    return c.json(
      {
        error: "Monthly generation limit reached",
        code: "E002",
        message: limitCheck.isPro
          ? "You've used all 75 Style Me credits this month. Credits reset on the 1st."
          : "You've used all 5 free Style Me credits this month. Upgrade to Pro for 75 monthly generations.",
        remaining: 0,
        used: limitCheck.used,
        limit: limitCheck.limit,
        resetsAt: limitCheck.resetsAt.toISOString(),
        upgradeUrl: limitCheck.isPro ? null : "/pro",
      },
      429
    );
  }

  await next();
}

// Legacy in-memory rate limiter (kept for backwards compatibility, but prefer styleMeLimitMiddleware)
export const styleMeLimit = createRateLimiter({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 75,
  keyGenerator: (c) => {
    const userId = c.get("userId") as string | undefined;
    return userId ? `style-me:${userId}` : `style-me:${c.req.header("x-forwarded-for") ?? "anonymous"}`;
  },
});

import { Hono } from "hono";
import { supabaseAdmin, isUserPro } from "../services/supabase.js";
import { getUserId } from "../middleware/auth.js";
import { checkStyleMeLimit } from "../middleware/rateLimit.js";
import { checkItemLimit, checkDailyOutfitLimit } from "../utils/limits.js";
import { TIER_LIMITS } from "../constants/tiers.js";

type Variables = {
  userId: string;
  email: string;
};

const debug = new Hono<{ Variables: Variables }>();

// Disable debug endpoints in production
if (process.env.NODE_ENV === "production") {
  debug.all("*", (c) => c.json({ error: "Debug endpoints disabled in production" }, 403));
}

/**
 * GET /tier-status - Get current tier and usage status
 */
debug.get("/tier-status", async (c) => {
  const userId = getUserId(c);

  // Get subscription
  const { data: subscription } = await supabaseAdmin
    .from("user_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .single();

  const isPro = await isUserPro(userId);
  const tier = isPro ? "pro" : "free";
  const limits = TIER_LIMITS[tier];

  // Check all limits
  const [styleMe, items, daily] = await Promise.all([
    checkStyleMeLimit(userId),
    checkItemLimit(userId),
    checkDailyOutfitLimit(userId),
  ]);

  return c.json({
    user_id: userId,
    tier,
    is_pro: isPro,
    subscription: subscription
      ? {
          expiry_date: subscription.expiry_date,
          started_at: subscription.started_at,
          in_grace_period: subscription.in_grace_period,
          is_trial: subscription.is_trial,
        }
      : null,
    usage: {
      style_me: {
        used: styleMe.used,
        limit: styleMe.limit,
        remaining: styleMe.remaining,
        resets_at: styleMe.resetsAt.toISOString(),
      },
      items: {
        used: items.used,
        limit: items.limit === Infinity ? "unlimited" : items.limit,
        remaining: items.limit === Infinity ? "unlimited" : items.limit - items.used,
      },
      daily_outfits: {
        used: daily.used,
        limit: daily.limit,
        remaining: daily.limit - daily.used,
        resets_at: daily.resetsAt.toISOString(),
      },
    },
    tier_limits: {
      max_wardrobe_items: limits.maxWardrobeItems === Infinity ? "unlimited" : limits.maxWardrobeItems,
      monthly_style_me_credits: limits.monthlyStyleMeCredits,
      daily_outfits: limits.dailyOutfits,
      outfit_history_days: limits.outfitHistoryDays === Infinity ? "unlimited" : limits.outfitHistoryDays,
      has_regeneration: limits.hasRegeneration,
      has_mood_filtering: limits.hasMoodFiltering,
      has_occasion_styling: limits.hasOccasionStyling,
    },
  });
});

/**
 * POST /reset-usage - Reset style_me and item counts
 */
debug.post("/reset-usage", async (c) => {
  const userId = getUserId(c);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);

  // Count outfits before deletion
  const { count: beforeCount } = await supabaseAdmin
    .from("generated_outfits")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("generated_at", monthStart.toISOString())
    .lt("generated_at", monthEnd.toISOString());

  // Delete this month's generated outfits (resets style_me credits)
  await supabaseAdmin
    .from("generated_outfits")
    .delete()
    .eq("user_id", userId)
    .gte("generated_at", monthStart.toISOString())
    .lt("generated_at", monthEnd.toISOString());

  const monthlyDeleted = beforeCount || 0;

  // Also reset the style_me_credits_used field in subscriptions (if used)
  await supabaseAdmin
    .from("user_subscriptions")
    .update({
      style_me_credits_used: 0,
      style_me_credits_reset_at: now.toISOString(),
    })
    .eq("user_id", userId);

  // Get updated limits
  const isPro = await isUserPro(userId);
  const limit = isPro ? TIER_LIMITS.pro.monthlyStyleMeCredits : TIER_LIMITS.free.monthlyStyleMeCredits;

  return c.json({
    success: true,
    message: "Usage reset successfully",
    reset: {
      generated_outfits_deleted: monthlyDeleted || 0,
      style_me_credits_reset: true,
    },
    current_status: {
      style_me_used: 0,
      style_me_limit: limit,
      style_me_remaining: limit,
    },
  });
});

/**
 * POST /toggle-pro - Toggle Pro subscription status
 */
debug.post("/toggle-pro", async (c) => {
  const userId = getUserId(c);

  // Get current subscription
  const { data: currentSub } = await supabaseAdmin
    .from("user_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .single();

  const wasProActive = await isUserPro(userId);
  const newIsPro = !wasProActive;

  // Calculate new expiry (1 year from now if enabling, past date if disabling)
  const newExpiry = newIsPro
    ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // Yesterday

  if (currentSub) {
    // Update existing subscription
    await supabaseAdmin
      .from("user_subscriptions")
      .update({
        is_pro: newIsPro,
        subscription_tier: newIsPro ? "pro" : "free",
        expiry_date: newExpiry,
        started_at: newIsPro ? new Date().toISOString() : currentSub.started_at,
        in_grace_period: false,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  } else {
    // Create new subscription
    await supabaseAdmin.from("user_subscriptions").insert({
      user_id: userId,
      is_pro: newIsPro,
      subscription_tier: newIsPro ? "pro" : "free",
      subscription_platform: "web",
      expiry_date: newExpiry,
      started_at: new Date().toISOString(),
      is_trial: false,
      in_grace_period: false,
    });
  }

  const newLimits = TIER_LIMITS[newIsPro ? "pro" : "free"];

  return c.json({
    success: true,
    message: `Subscription ${newIsPro ? "upgraded to Pro" : "downgraded to Free"}`,
    previous: {
      tier: wasProActive ? "pro" : "free",
      is_pro: wasProActive,
    },
    current: {
      tier: newIsPro ? "pro" : "free",
      is_pro: newIsPro,
      expiry_date: newExpiry,
      limits: {
        monthly_style_me_credits: newLimits.monthlyStyleMeCredits,
        daily_outfits: newLimits.dailyOutfits,
        max_items: newLimits.maxWardrobeItems === Infinity ? "unlimited" : newLimits.maxWardrobeItems,
      },
    },
  });
});

/**
 * POST /test-rate-limit - Simulate a style-me call to test rate limiting
 */
debug.post("/test-rate-limit", async (c) => {
  const userId = getUserId(c);

  // Check current limits (without actually generating)
  const [styleMe, daily] = await Promise.all([
    checkStyleMeLimit(userId),
    checkDailyOutfitLimit(userId),
  ]);

  // Check if daily limit would be exceeded
  if (!daily.allowed) {
    return c.json(
      {
        error: "E002",
        code: "daily_limit_reached",
        message: "You've reached your daily outfit generation limit",
        daily: {
          used: daily.used,
          limit: daily.limit,
          remaining: 0,
          resets_at: daily.resetsAt.toISOString(),
        },
        upgrade_required: !daily.isPro,
      },
      429
    );
  }

  // Check if monthly limit would be exceeded
  if (!styleMe.allowed) {
    return c.json(
      {
        error: "E002",
        code: "monthly_limit_reached",
        message: styleMe.isPro
          ? "You've used all 75 Style Me credits this month. Credits reset on the 1st."
          : "You've used all 5 free Style Me credits this month. Upgrade to Pro for 75 monthly generations.",
        monthly: {
          used: styleMe.used,
          limit: styleMe.limit,
          remaining: 0,
          resets_at: styleMe.resetsAt.toISOString(),
        },
        upgrade_url: styleMe.isPro ? null : "/pro",
      },
      429
    );
  }

  // Simulate what would happen if we generated an outfit
  return c.json({
    success: true,
    message: "Rate limit check passed - generation would be allowed",
    would_use: {
      monthly: {
        current: styleMe.used,
        after: styleMe.used + 1,
        limit: styleMe.limit,
        remaining_after: styleMe.remaining - 1,
      },
      daily: {
        current: daily.used,
        after: daily.used + 1,
        limit: daily.limit,
        remaining_after: daily.limit - daily.used - 1,
      },
    },
    is_pro: styleMe.isPro,
  });
});

/**
 * GET /limits-config - Get the tier limits configuration
 */
debug.get("/limits-config", async (c) => {
  return c.json({
    tiers: TIER_LIMITS,
    error_codes: {
      E001: "Item limit reached",
      E002: "Credit limit reached (monthly or daily)",
      E003: "Pro subscription required",
    },
  });
});

export default debug;

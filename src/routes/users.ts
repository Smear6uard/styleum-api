import { Hono } from "hono";
import {
  getUserSubscription,
  isUserPro,
  getUser,
  getUserGamification,
  supabaseAdmin,
} from "../services/supabase.js";
import {
  checkItemLimit,
  checkCreditLimit,
  checkDailyOutfitLimit,
} from "../utils/limits.js";
import { TIER_LIMITS, type TierName } from "../constants/tiers.js";
import { getUserId } from "../middleware/auth.js";

type Variables = {
  userId: string;
  email: string;
};

const users = new Hono<{ Variables: Variables }>();

/**
 * GET /tier - Get comprehensive tier info with all limits and usage
 * This is an alias for /api/subscriptions/tier for iOS compatibility
 */
users.get("/tier", async (c) => {
  const userId = getUserId(c);

  // Fetch all data in parallel
  const [subscription, isPro, itemLimit, creditLimit, dailyLimit, profile, gamification] =
    await Promise.all([
      getUserSubscription(userId),
      isUserPro(userId),
      checkItemLimit(userId),
      checkCreditLimit(userId),
      checkDailyOutfitLimit(userId),
      getUser(userId),
      getUserGamification(userId),
    ]);

  const tier: TierName = isPro ? "pro" : "free";
  const limits = TIER_LIMITS[tier];

  // Get streak freezes info from gamification data
  const streakFreezesAvailable = gamification?.streak_freezes_available ?? 0;

  // Calculate max wardrobe items for iOS (use -1 for unlimited)
  const maxWardrobeItems = limits.maxWardrobeItems === Infinity ? -1 : limits.maxWardrobeItems;

  return c.json({
    tier,
    // iOS expects isPro (camelCase)
    isPro: isPro,
    // Also include is_pro for backwards compatibility
    is_pro: isPro,
    // iOS-expected limits shape
    limits: {
      max_wardrobe_items: maxWardrobeItems,
      generations_per_month: creditLimit.limit,
      generations_used: creditLimit.used,
      generations_remaining: creditLimit.limit - creditLimit.used,
      resets_at: getNextMonthStart(),
      // Also include original fields for backwards compatibility
      maxWardrobeItems: limits.maxWardrobeItems === Infinity ? null : limits.maxWardrobeItems,
      dailyOutfits: limits.dailyOutfits,
      monthlyStyleMeCredits: limits.monthlyStyleMeCredits,
      outfitHistoryDays: limits.outfitHistoryDays === Infinity ? null : limits.outfitHistoryDays,
      streakFreezesPerMonth: limits.streakFreezesPerMonth,
    },
    subscription: subscription
      ? {
          expires_at: subscription.expiry_date,
          platform: subscription.subscription_platform,
          is_active: isPro,
          in_grace_period: subscription.in_grace_period ?? false,
          grace_period_expires_at: subscription.grace_period_expires_at ?? null,
          has_billing_issue: subscription.has_billing_issue ?? false,
        }
      : null,
    features: {
      hasAnalytics: limits.hasAnalytics,
      hasOccasionStyling: limits.hasOccasionStyling,
      hasMoodFiltering: limits.hasMoodFiltering,
      hasRegeneration: limits.hasRegeneration,
      unlimitedItems: limits.maxWardrobeItems === Infinity,
      unlimitedHistory: limits.outfitHistoryDays === Infinity,
    },
    usage: {
      // iOS expects snake_case wardrobe_items
      wardrobe_items: itemLimit.used,
      wardrobeItems: {
        used: itemLimit.used,
        limit: itemLimit.limit === Infinity ? null : (itemLimit.limit as number),
        remaining: itemLimit.limit === Infinity ? null : (itemLimit.limit as number) - itemLimit.used,
      },
      dailyOutfits: {
        used: dailyLimit.used,
        limit: dailyLimit.limit,
        remaining: dailyLimit.limit - dailyLimit.used,
        resetsAt: dailyLimit.resetsAt.toISOString(),
      },
      monthlyCredits: {
        used: creditLimit.used,
        limit: creditLimit.limit,
        remaining: creditLimit.limit - creditLimit.used,
        resetsAt: getNextMonthStart(),
      },
    },
    flags: {
      canAddItem: itemLimit.allowed,
      canGenerateOutfit: dailyLimit.allowed && creditLimit.allowed,
      canUseStyleMe: creditLimit.allowed,
      dailyLimitReached: !dailyLimit.allowed,
      monthlyLimitReached: !creditLimit.allowed,
    },
    streakFreezes: {
      available: streakFreezesAvailable,
      limit: limits.streakFreezesPerMonth,
    },
    onboarding: {
      tier_onboarding_seen: !!profile?.tier_onboarding_seen_at,
      tier_onboarding_seen_at: profile?.tier_onboarding_seen_at ?? null,
    },
  });
});

/**
 * POST /tier-onboarding-seen - Mark tier onboarding as seen
 * Alias for /api/profile/tier-onboarding-seen (iOS compatibility)
 */
users.post("/tier-onboarding-seen", async (c) => {
  const userId = getUserId(c);
  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("user_profiles")
    .update({ tier_onboarding_seen_at: now })
    .eq("id", userId);

  if (error) {
    console.error("[Users] Failed to mark tier onboarding as seen:", error);
    return c.json({ error: "Failed to update profile" }, 500);
  }

  return c.json({ success: true, tier_onboarding_seen_at: now });
});

function getNextMonthStart(): string {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return nextMonth.toISOString();
}

export default users;

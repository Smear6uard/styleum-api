import { Hono } from "hono";
import {
  getUserSubscription,
  isUserPro,
  getUser,
  getUserGamification,
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

const subscriptions = new Hono<{ Variables: Variables }>();

/**
 * GET /status - Get subscription status with is_active computed
 */
subscriptions.get("/status", async (c) => {
  const userId = getUserId(c);

  const subscription = await getUserSubscription(userId);
  const isPro = await isUserPro(userId);

  if (!subscription) {
    return c.json({
      subscription: null,
      is_active: false,
      is_pro: false,
    });
  }

  return c.json({
    subscription: {
      ...subscription,
      is_active: isPro,
    },
    is_pro: isPro,
  });
});

/**
 * GET /limits - Get current usage vs limits for items and credits
 */
subscriptions.get("/limits", async (c) => {
  const userId = getUserId(c);

  const [itemLimit, creditLimit, isPro] = await Promise.all([
    checkItemLimit(userId),
    checkCreditLimit(userId),
    isUserPro(userId),
  ]);

  return c.json({
    is_pro: isPro,
    items: {
      used: itemLimit.used,
      limit: itemLimit.limit === Infinity ? null : itemLimit.limit,
      unlimited: itemLimit.limit === Infinity,
    },
    credits: {
      used: creditLimit.used,
      limit: creditLimit.limit,
      resets_at: getNextMonthStart(),
    },
  });
});

/**
 * GET /tier - Get comprehensive tier info with all limits and usage
 * Returns current tier, all limits, current usage, feature flags, streak freezes, and onboarding status
 */
subscriptions.get("/tier", async (c) => {
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

  return c.json({
    tier,
    is_pro: isPro,
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
    limits: {
      maxWardrobeItems:
        limits.maxWardrobeItems === Infinity ? null : limits.maxWardrobeItems,
      dailyOutfits: limits.dailyOutfits,
      monthlyStyleMeCredits: limits.monthlyStyleMeCredits,
      outfitHistoryDays:
        limits.outfitHistoryDays === Infinity ? null : limits.outfitHistoryDays,
      streakFreezesPerMonth: limits.streakFreezesPerMonth,
    },
    features: {
      hasAnalytics: limits.hasAnalytics,
      hasOccasionStyling: limits.hasOccasionStyling,
      hasMoodFiltering: limits.hasMoodFiltering,
      hasRegeneration: limits.hasRegeneration,
      unlimitedItems: limits.maxWardrobeItems === Infinity,
      unlimitedHistory: limits.outfitHistoryDays === Infinity,
    },
    usage: {
      wardrobeItems: {
        used: itemLimit.used,
        limit:
          itemLimit.limit === Infinity ? null : (itemLimit.limit as number),
        remaining:
          itemLimit.limit === Infinity
            ? null
            : (itemLimit.limit as number) - itemLimit.used,
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

function getNextMonthStart(): string {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return nextMonth.toISOString();
}

export default subscriptions;

import { supabaseAdmin, isUserPro } from "../services/supabase.js";
import { TIER_LIMITS } from "../constants/tiers.js";

// Export constants (keeping backward compatibility)
export const FREE_ITEM_LIMIT = TIER_LIMITS.free.maxWardrobeItems; // 30
export const FREE_CREDIT_LIMIT = TIER_LIMITS.free.monthlyStyleMeCredits; // 5
export const PRO_CREDIT_LIMIT = TIER_LIMITS.pro.monthlyStyleMeCredits; // 75

export interface LimitCheck {
  allowed: boolean;
  used: number;
  limit: number;
  isPro?: boolean;
}

export interface DailyLimitCheck extends LimitCheck {
  resetsAt: Date;
}

/**
 * Check wardrobe item limit for a user
 * Free: 30 items, Pro: unlimited
 */
export async function checkItemLimit(userId: string): Promise<LimitCheck> {
  const isPro = await isUserPro(userId);

  const { count } = await supabaseAdmin
    .from("wardrobe_items")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_archived", false);

  const used = count ?? 0;
  const limit = isPro ? Infinity : FREE_ITEM_LIMIT;

  return {
    allowed: used < limit,
    used,
    limit,
    isPro,
  };
}

/**
 * Check monthly Style Me credit limit for a user
 * Free: 5/month, Pro: 75/month
 */
export async function checkCreditLimit(userId: string): Promise<LimitCheck> {
  const isPro = await isUserPro(userId);
  const limit = isPro ? PRO_CREDIT_LIMIT : FREE_CREDIT_LIMIT;

  // Count style generations this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { count } = await supabaseAdmin
    .from("generated_outfits")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfMonth.toISOString());

  const used = count ?? 0;

  return {
    allowed: used < limit,
    used,
    limit,
    isPro,
  };
}

/**
 * Check daily outfit generation limit for a user
 * Free: 2/day, Pro: 4/day
 */
export async function checkDailyOutfitLimit(
  userId: string
): Promise<DailyLimitCheck> {
  const isPro = await isUserPro(userId);
  const limit = isPro
    ? TIER_LIMITS.pro.dailyOutfits
    : TIER_LIMITS.free.dailyOutfits;

  // Get today's start in UTC
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Count outfit generations today
  const { count } = await supabaseAdmin
    .from("generated_outfits")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("generated_at", today.toISOString());

  const used = count ?? 0;

  // Calculate tomorrow's reset time
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  return {
    allowed: used < limit,
    used,
    limit,
    isPro,
    resetsAt: tomorrow,
  };
}

/**
 * Get history day limit for a user's tier
 * Free: 7 days, Pro: unlimited
 */
export async function getHistoryDayLimit(userId: string): Promise<{
  limitDays: number;
  cutoffDate: Date | null;
  isPro: boolean;
}> {
  const isPro = await isUserPro(userId);
  const limitDays = isPro
    ? TIER_LIMITS.pro.outfitHistoryDays
    : TIER_LIMITS.free.outfitHistoryDays;

  // Calculate cutoff date (null for unlimited)
  let cutoffDate: Date | null = null;
  if (limitDays !== Infinity) {
    cutoffDate = new Date();
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - limitDays);
    cutoffDate.setUTCHours(0, 0, 0, 0);
  }

  return {
    limitDays,
    cutoffDate,
    isPro,
  };
}

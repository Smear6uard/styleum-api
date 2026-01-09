/**
 * Tier system constants
 * Defines limits and features for free and pro subscription tiers
 */

export const TIER_LIMITS = {
  free: {
    maxWardrobeItems: 30,
    dailyOutfits: 2,
    monthlyStyleMeCredits: 5,
    outfitHistoryDays: 7,
    streakFreezesPerMonth: 1,
    hasAnalytics: false,
    hasOccasionStyling: false,
    hasMoodFiltering: false,
    hasRegeneration: false,
  },
  pro: {
    maxWardrobeItems: Infinity,
    dailyOutfits: 4,
    monthlyStyleMeCredits: 75,
    outfitHistoryDays: Infinity,
    streakFreezesPerMonth: 5,
    hasAnalytics: true,
    hasOccasionStyling: true,
    hasMoodFiltering: true,
    hasRegeneration: true,
  },
} as const;

export type TierName = keyof typeof TIER_LIMITS;
export type TierLimits = (typeof TIER_LIMITS)[TierName];

/**
 * Grace period duration in days after subscription expiration
 * Users retain pro access during this period to allow for payment resolution
 */
export const GRACE_PERIOD_DAYS = 7;

/**
 * Get limits for a given tier
 */
export function getTierLimits(tier: TierName): TierLimits {
  return TIER_LIMITS[tier];
}

/**
 * Check if a tier has a specific feature
 */
export function tierHasFeature(
  tier: TierName,
  feature: keyof TierLimits
): boolean {
  const limits = TIER_LIMITS[tier];
  const value = limits[feature];
  if (typeof value === "boolean") {
    return value;
  }
  // For numeric values, check if it's greater than 0
  return value > 0;
}

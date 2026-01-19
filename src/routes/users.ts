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

/**
 * GET /:id - Get user profile with stats
 * Returns user profile data with school info, gamification stats, and post counts
 */
users.get("/:id", async (c) => {
  const currentUserId = getUserId(c);
  const targetUserId = c.req.param("id");

  try {
    // Fetch user profile with school info
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .select(`
        id,
        display_name,
        username,
        tier,
        created_at,
        schools (
          id,
          name,
          short_name,
          slug
        )
      `)
      .eq("id", targetUserId)
      .single();

    if (profileError || !profile) {
      return c.json({ error: "User not found" }, 404);
    }

    // Fetch gamification data and post stats in parallel
    const [gamificationResult, postsResult] = await Promise.all([
      supabaseAdmin
        .from("user_gamification")
        .select("xp, current_streak")
        .eq("user_id", targetUserId)
        .single(),
      supabaseAdmin
        .from("outfit_history")
        .select("id, vote_count")
        .eq("user_id", targetUserId)
        .eq("is_public", true),
    ]);

    const gamification = gamificationResult.data;
    const posts = postsResult.data || [];

    // Calculate stats
    const postCount = posts.length;
    const votesReceived = posts.reduce((sum, post) => sum + (post.vote_count || 0), 0);
    const xp = gamification?.xp || 0;
    const streak = gamification?.current_streak || 0;

    // Calculate level from XP (100 XP per level)
    const level = Math.floor(xp / 100) + 1;

    // Extract school info (handle both array and single object for FK relations)
    const schoolsData = profile.schools as unknown;
    const school = Array.isArray(schoolsData) ? schoolsData[0] : schoolsData as { id: string; name: string; short_name: string; slug: string } | null;

    return c.json({
      user: {
        id: profile.id,
        display_name: profile.display_name,
        username: profile.username,
        tier: profile.tier,
        school: school
          ? {
              id: school.id,
              name: school.name,
              short_name: school.short_name,
              slug: school.slug,
            }
          : null,
        created_at: profile.created_at,
      },
      stats: {
        posts: postCount,
        votes_received: votesReceived,
        streak,
        xp,
        level,
      },
      is_own_profile: currentUserId === targetUserId,
    });
  } catch (error) {
    console.error("[Users] Error fetching user profile:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * GET /:id/posts - Get user's public posts
 * Returns paginated list of user's public posts with vote status and item details
 * Query params: cursor (created_at timestamp), limit (default 20)
 */
users.get("/:id/posts", async (c) => {
  const currentUserId = getUserId(c);
  const targetUserId = c.req.param("id");
  const cursor = c.req.query("cursor"); // ISO timestamp for pagination
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);

  try {
    // Verify user exists
    const { data: userExists, error: userError } = await supabaseAdmin
      .from("user_profiles")
      .select("id")
      .eq("id", targetUserId)
      .single();

    if (userError || !userExists) {
      return c.json({ error: "User not found" }, 404);
    }

    // Build query for public posts
    let query = supabaseAdmin
      .from("outfit_history")
      .select(`
        id,
        photo_url,
        caption,
        vote_count,
        verification_type,
        items,
        created_at
      `)
      .eq("user_id", targetUserId)
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(limit + 1); // Fetch one extra to determine if there's more

    // Apply cursor for pagination
    if (cursor) {
      query = query.lt("created_at", cursor);
    }

    const { data: posts, error: postsError } = await query;

    if (postsError) {
      console.error("[Users] Failed to fetch user posts:", postsError);
      return c.json({ error: "Failed to fetch posts" }, 500);
    }

    // Check if there are more results
    const hasMore = posts && posts.length > limit;
    const results = hasMore ? posts.slice(0, limit) : posts || [];
    const nextCursor = hasMore ? results[results.length - 1]?.created_at : null;

    // Get current user's votes on these posts
    const postIds = results.map((p) => p.id);
    const { data: userVotes } = await supabaseAdmin
      .from("votes")
      .select("outfit_history_id")
      .eq("user_id", currentUserId)
      .in("outfit_history_id", postIds);

    const votedSet = new Set(userVotes?.map((v) => v.outfit_history_id) || []);

    // Get item images for posts
    const allItemIds = results.flatMap((p) => p.items || []);
    const uniqueItemIds = [...new Set(allItemIds)] as string[];

    let itemMap = new Map<string, { id: string; processed_image_url: string; category: string }>();
    if (uniqueItemIds.length > 0) {
      const { data: items } = await supabaseAdmin
        .from("wardrobe_items")
        .select("id, processed_image_url, category")
        .in("id", uniqueItemIds);

      itemMap = new Map(items?.map((i) => [i.id, i]) || []);
    }

    // Build enriched response
    const enrichedPosts = results.map((post) => {
      const postItems = ((post.items || []) as string[])
        .map((id) => itemMap.get(id))
        .filter((item): item is { id: string; processed_image_url: string; category: string } => item !== undefined);

      return {
        id: post.id,
        photo_url: post.photo_url,
        caption: post.caption,
        vote_count: post.vote_count || 0,
        is_verified: post.verification_type === "photo",
        has_voted: votedSet.has(post.id),
        items: postItems.map((item) => ({
          id: item.id,
          processed_image_url: item.processed_image_url,
          category: item.category,
        })),
        created_at: post.created_at,
      };
    });

    return c.json({
      posts: enrichedPosts,
      next_cursor: nextCursor,
      has_more: hasMore,
    });
  } catch (error) {
    console.error("[Users] Error fetching user posts:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

function getNextMonthStart(): string {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return nextMonth.toISOString();
}

export default users;

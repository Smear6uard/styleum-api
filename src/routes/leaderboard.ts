/**
 * Leaderboard Routes - Protected Endpoints
 * Tier-grouped leaderboards for campus competition
 * Uses LeaderboardService for optimized queries with caching
 */

import { Hono } from "hono";
import { supabaseAdmin, isUserPro } from "../services/supabase.js";
import { LeaderboardService } from "../services/leaderboardService.js";
import { getUserId } from "../middleware/auth.js";

type Variables = {
  userId: string;
  email: string;
};

const leaderboardRoutes = new Hono<{ Variables: Variables }>();

// Tier order for display (highest to lowest)
const TIER_ORDER = ["legend", "icon", "maven", "builder", "seeker", "rookie"];

/**
 * GET /:school_slug - Get tier-grouped leaderboard for a school
 * Returns top users per tier, grouped by tier
 * Uses LeaderboardService with 60s caching
 */
leaderboardRoutes.get("/:school_slug", async (c) => {
  const userId = getUserId(c);
  const schoolSlug = c.req.param("school_slug");
  const limitParam = c.req.query("limit");
  const limit = limitParam ? parseInt(limitParam, 10) : 100;

  try {
    // Get school info for response
    const { data: school, error: schoolError } = await supabaseAdmin
      .from("schools")
      .select("id, name, short_name")
      .eq("slug", schoolSlug)
      .eq("is_active", true)
      .single();

    if (schoolError || !school) {
      return c.json({ error: "School not found" }, 404);
    }

    // Use service for cached, optimized query
    const result = await LeaderboardService.getSchoolLeaderboard(school.id, {
      limit,
      userId,
    });

    // Transform tiers to the expected response format
    interface ResponseEntry {
      user_id: string;
      display_name: string;
      username: string | null;
      avatar_url: string | null;
      tier: string;
      weekly_votes: number;
      weekly_posts: number;
      current_streak: number;
      rank: number;
    }
    const tierGroups: Record<string, ResponseEntry[]> = {};
    for (const tierGroup of result.tiers) {
      tierGroups[tierGroup.tier] = tierGroup.entries.map((entry) => ({
        user_id: entry.userId,
        display_name: entry.displayName,
        username: entry.username,
        avatar_url: entry.avatarUrl,
        tier: entry.tier,
        weekly_votes: entry.totalVotes,
        weekly_posts: entry.outfitsPosted,
        current_streak: entry.currentStreak,
        rank: entry.tierRank,
      }));
    }

    // Remove empty tiers
    const activeTiers = Object.fromEntries(
      Object.entries(tierGroups).filter(([_, entries]) => entries.length > 0)
    );

    return c.json({
      school: {
        id: school.id,
        name: school.name,
        short_name: school.short_name,
        slug: schoolSlug,
      },
      week_start: result.weekStart,
      tiers: activeTiers,
      tier_order: TIER_ORDER.filter((t) => activeTiers[t]?.length > 0),
      current_user: result.currentUser
        ? {
            rank: result.currentUser.rank,
            tier: result.currentUser.tier,
            weekly_votes: result.currentUser.totalVotes,
            weekly_posts: result.currentUser.outfitsPosted,
            percentile: result.currentUser.percentile,
          }
        : null,
      total_participants: result.totalParticipants,
    });
  } catch (error) {
    console.error("[Leaderboard] Error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * GET /:school_slug/my-tier - Get just the user's tier leaderboard
 * Useful for focused view of competition in user's current tier
 */
leaderboardRoutes.get("/:school_slug/my-tier", async (c) => {
  const userId = getUserId(c);
  const schoolSlug = c.req.param("school_slug");

  try {
    // Get user's profile to find their tier
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .select("school_id, tier")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return c.json({ error: "Profile not found" }, 404);
    }

    // Verify school matches
    const { data: school, error: schoolError } = await supabaseAdmin
      .from("schools")
      .select("id, name, short_name, slug")
      .eq("slug", schoolSlug)
      .eq("is_active", true)
      .single();

    if (schoolError || !school) {
      return c.json({ error: "School not found" }, 404);
    }

    if (profile.school_id !== school.id) {
      return c.json({ error: "You are not a member of this school" }, 403);
    }

    const userTier = profile.tier || "rookie";

    // Use service with tier filter
    const result = await LeaderboardService.getSchoolLeaderboard(school.id, {
      tier: userTier,
      limit: 50,
      userId,
    });

    return c.json({
      school: {
        id: school.id,
        name: school.name,
        short_name: school.short_name,
        slug: schoolSlug,
      },
      tier: userTier,
      week_start: result.weekStart,
      leaderboard: result.entries.map((entry) => ({
        user_id: entry.userId,
        display_name: entry.displayName,
        username: entry.username,
        avatar_url: entry.avatarUrl,
        weekly_votes: entry.totalVotes,
        weekly_posts: entry.outfitsPosted,
        current_streak: entry.currentStreak,
        rank: entry.tierRank,
        is_current_user: entry.userId === userId,
      })),
      current_user: result.currentUser
        ? {
            rank: result.currentUser.rank,
            weekly_votes: result.currentUser.totalVotes,
            weekly_posts: result.currentUser.outfitsPosted,
            percentile: result.currentUser.percentile,
          }
        : null,
    });
  } catch (error) {
    console.error("[Leaderboard] Error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * GET /me/stats - Get current user's weekly stats
 */
leaderboardRoutes.get("/me/stats", async (c) => {
  const userId = getUserId(c);

  try {
    const stats = await LeaderboardService.getUserWeeklyStats(userId);

    if (!stats) {
      return c.json({
        rank: null,
        tier: "rookie",
        weekly_votes: 0,
        weekly_posts: 0,
        percentile: 0,
        message: "Not participating in leaderboard this week",
      });
    }

    return c.json({
      rank: stats.rank,
      tier: stats.tier,
      weekly_votes: stats.totalVotes,
      weekly_posts: stats.outfitsPosted,
      percentile: stats.percentile,
    });
  } catch (error) {
    console.error("[Leaderboard] Error fetching user stats:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * GET /me/voters - Get all voters on user's outfits this week (Pro-only)
 * Paginated list of who voted on your outfits
 */
leaderboardRoutes.get("/me/voters", async (c) => {
  const userId = getUserId(c);
  const limitParam = c.req.query("limit");
  const offsetParam = c.req.query("offset");
  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0;

  try {
    const result = await LeaderboardService.getUserVoters(userId, {
      limit,
      offset,
    });

    // Check if empty due to not being Pro
    if (result.voters.length === 0 && result.totalCount === 0) {
      const isPro = await isUserPro(userId);
      if (!isPro) {
        return c.json({ error: "Pro subscription required to view voters" }, 403);
      }
    }

    return c.json({
      voters: result.voters.map((v) => ({
        user_id: v.id,
        display_name: v.displayName,
        username: v.username,
        avatar_url: v.avatarUrl,
        tier: v.tier,
        voted_at: v.votedAt,
      })),
      total: result.totalCount,
      has_more: result.hasMore,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[Leaderboard] Error fetching voters:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * GET /:school_slug/voters - Pro-only voter list for a specific outfit
 * Query param: outfit_history_id
 */
leaderboardRoutes.get("/:school_slug/voters", async (c) => {
  const userId = getUserId(c);
  const outfitHistoryId = c.req.query("outfit_history_id");

  if (!outfitHistoryId) {
    return c.json({ error: "outfit_history_id query param is required" }, 400);
  }

  try {
    // Check if user is pro
    const isPro = await isUserPro(userId);

    if (!isPro) {
      return c.json({ error: "Pro subscription required to view voters" }, 403);
    }

    // Verify the outfit belongs to the requesting user
    const { data: outfit, error: outfitError } = await supabaseAdmin
      .from("outfit_history")
      .select("user_id")
      .eq("id", outfitHistoryId)
      .single();

    if (outfitError || !outfit) {
      return c.json({ error: "Outfit not found" }, 404);
    }

    if (outfit.user_id !== userId) {
      return c.json({ error: "You can only view voters on your own outfits" }, 403);
    }

    // Get voters
    const { data: votes, error: votesError } = await supabaseAdmin
      .from("votes")
      .select("user_id, created_at")
      .eq("outfit_history_id", outfitHistoryId)
      .order("created_at", { ascending: false });

    if (votesError) {
      console.error("[Leaderboard] Failed to fetch voters:", votesError);
      return c.json({ error: "Failed to fetch voters" }, 500);
    }

    // Get voter profiles
    const voterIds = votes?.map((v) => v.user_id) || [];
    const { data: profiles } = await supabaseAdmin
      .from("user_profiles")
      .select("id, display_name, username, avatar_url, tier")
      .in("id", voterIds);

    const profileMap = new Map(profiles?.map((p) => [p.id, p]) || []);

    const voters = votes?.map((vote) => {
      const profile = profileMap.get(vote.user_id);
      return {
        user_id: vote.user_id,
        display_name: profile?.display_name || "Anonymous",
        username: profile?.username || null,
        avatar_url: profile?.avatar_url,
        tier: profile?.tier,
        voted_at: vote.created_at,
      };
    });

    return c.json({
      voters: voters || [],
      total: voters?.length || 0,
    });
  } catch (error) {
    console.error("[Leaderboard] Error fetching voters:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * POST /refresh - Trigger a leaderboard refresh
 * Has 5-minute cooldown to prevent abuse
 */
leaderboardRoutes.post("/refresh", async (c) => {
  try {
    const result = await LeaderboardService.refreshLeaderboard();

    if (!result.success) {
      return c.json(
        {
          error: result.message,
          success: false,
        },
        result.message.includes("cooldown") ? 429 : 500
      );
    }

    console.log(`[Leaderboard] Refreshed in ${result.durationMs}ms`);

    return c.json({
      success: true,
      message: result.message,
      duration_ms: result.durationMs,
    });
  } catch (error) {
    console.error("[Leaderboard] Error refreshing:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default leaderboardRoutes;

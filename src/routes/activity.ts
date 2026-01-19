/**
 * Activity Routes - Protected Endpoints
 * Vote activity feed for the "God Mode" dopamine loop feature
 * Pro users see full voter identity, Free users see masked voters (tier only as teaser)
 */

import { Hono } from "hono";
import { supabaseAdmin, isUserPro } from "../services/supabase.js";
import { getUserId } from "../middleware/auth.js";

type Variables = {
  userId: string;
  email: string;
};

const activityRoutes = new Hono<{ Variables: Variables }>();

/**
 * GET / - Paginated vote activity feed
 * Returns votes on user's public posts with voter info
 * Pro users see full voter identity, Free users see masked voters (tier visible as teaser)
 */
activityRoutes.get("/", async (c) => {
  const userId = getUserId(c);
  const cursor = c.req.query("cursor"); // ISO timestamp for pagination
  const limitParam = c.req.query("limit");
  const limit = Math.min(limitParam ? parseInt(limitParam, 10) : 30, 50);

  try {
    // Step 1: Check if user is Pro
    const isPro = await isUserPro(userId);

    // Step 2: Get user's public post IDs from outfit_history
    const { data: userPosts, error: postsError } = await supabaseAdmin
      .from("outfit_history")
      .select("id")
      .eq("user_id", userId)
      .eq("is_public", true);

    if (postsError) {
      console.error("[Activity] Failed to fetch user posts:", postsError);
      return c.json({ error: "Failed to fetch activity" }, 500);
    }

    const postIds = userPosts?.map((p) => p.id) || [];

    // If user has no public posts, return empty activity
    if (postIds.length === 0) {
      return c.json({
        activities: [],
        has_more: false,
        next_cursor: null,
        is_pro: isPro,
        total_votes: 0,
      });
    }

    // Step 3: Query votes on user's posts
    let votesQuery = supabaseAdmin
      .from("votes")
      .select("id, user_id, outfit_history_id, created_at")
      .in("outfit_history_id", postIds)
      .order("created_at", { ascending: false })
      .limit(limit + 1); // Fetch one extra to check if there are more

    // Apply cursor if provided
    if (cursor) {
      votesQuery = votesQuery.lt("created_at", cursor);
    }

    const { data: votes, error: votesError } = await votesQuery;

    if (votesError) {
      console.error("[Activity] Failed to fetch votes:", votesError);
      return c.json({ error: "Failed to fetch activity" }, 500);
    }

    // Check if there are more results
    const hasMore = (votes?.length || 0) > limit;
    const votesToReturn = hasMore ? votes?.slice(0, limit) : votes;

    // Step 4: Get voter profiles
    const voterIds = Array.from(new Set(votesToReturn?.map((v) => v.user_id) || []));
    const { data: profiles, error: profilesError } = await supabaseAdmin
      .from("user_profiles")
      .select("id, display_name, username, avatar_url, tier")
      .in("id", voterIds);

    if (profilesError) {
      console.error("[Activity] Failed to fetch voter profiles:", profilesError);
      return c.json({ error: "Failed to fetch activity" }, 500);
    }

    const profileMap = new Map(profiles?.map((p) => [p.id, p]) || []);

    // Step 5: Get outfit thumbnails
    const outfitIds = Array.from(new Set(votesToReturn?.map((v) => v.outfit_history_id) || []));
    const { data: outfits, error: outfitsError } = await supabaseAdmin
      .from("outfit_history")
      .select("id, photo_url")
      .in("id", outfitIds);

    if (outfitsError) {
      console.error("[Activity] Failed to fetch outfit thumbnails:", outfitsError);
      return c.json({ error: "Failed to fetch activity" }, 500);
    }

    const outfitMap = new Map(outfits?.map((o) => [o.id, o]) || []);

    // Step 6: Get total vote count for user's posts
    const { count: totalVotes } = await supabaseAdmin
      .from("votes")
      .select("*", { count: "exact", head: true })
      .in("outfit_history_id", postIds);

    // Step 7: Map and mask data based on Pro status
    const activities = votesToReturn?.map((vote) => {
      const profile = profileMap.get(vote.user_id);
      const outfit = outfitMap.get(vote.outfit_history_id);

      return {
        id: vote.id,
        type: "vote" as const,
        created_at: vote.created_at,
        voter: {
          // Pro users see full identity, Free users see masked (null) except tier
          id: isPro ? vote.user_id : null,
          display_name: isPro ? (profile?.display_name || "Anonymous") : null,
          username: isPro ? (profile?.username || null) : null,
          avatar_url: isPro ? (profile?.avatar_url || null) : null,
          tier: profile?.tier || "rookie", // Always visible as teaser for upgrade
        },
        outfit: {
          id: vote.outfit_history_id,
          photo_url: outfit?.photo_url || null,
        },
        is_revealed: isPro, // Indicates whether voter identity is visible
      };
    }) || [];

    // Calculate next cursor
    const nextCursor = hasMore && votesToReturn && votesToReturn.length > 0
      ? votesToReturn[votesToReturn.length - 1].created_at
      : null;

    return c.json({
      activities,
      has_more: hasMore,
      next_cursor: nextCursor,
      is_pro: isPro,
      total_votes: totalVotes || 0,
    });
  } catch (error) {
    console.error("[Activity] Error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * GET /summary - Badge counts for activity
 * Returns total votes and unread (last 24 hours) count
 */
activityRoutes.get("/summary", async (c) => {
  const userId = getUserId(c);

  try {
    // Get user's public post IDs
    const { data: userPosts, error: postsError } = await supabaseAdmin
      .from("outfit_history")
      .select("id")
      .eq("user_id", userId)
      .eq("is_public", true);

    if (postsError) {
      console.error("[Activity] Failed to fetch user posts:", postsError);
      return c.json({ error: "Failed to fetch activity summary" }, 500);
    }

    const postIds = userPosts?.map((p) => p.id) || [];

    // If user has no public posts, return zero counts
    if (postIds.length === 0) {
      return c.json({
        unread_count: 0,
        total_votes: 0,
      });
    }

    // Get total vote count
    const { count: totalVotes, error: totalError } = await supabaseAdmin
      .from("votes")
      .select("*", { count: "exact", head: true })
      .in("outfit_history_id", postIds);

    if (totalError) {
      console.error("[Activity] Failed to count total votes:", totalError);
      return c.json({ error: "Failed to fetch activity summary" }, 500);
    }

    // Get votes in last 24 hours for "new" badge
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const { count: unreadCount, error: unreadError } = await supabaseAdmin
      .from("votes")
      .select("*", { count: "exact", head: true })
      .in("outfit_history_id", postIds)
      .gte("created_at", twentyFourHoursAgo.toISOString());

    if (unreadError) {
      console.error("[Activity] Failed to count unread votes:", unreadError);
      return c.json({ error: "Failed to fetch activity summary" }, 500);
    }

    return c.json({
      unread_count: unreadCount || 0,
      total_votes: totalVotes || 0,
    });
  } catch (error) {
    console.error("[Activity] Error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default activityRoutes;

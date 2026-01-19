/**
 * Feed Routes - Protected Endpoints
 * School feed and outfit publishing
 */

import { Hono } from "hono";
import { supabaseAdmin } from "../services/supabase.js";
import { getUserId } from "../middleware/auth.js";

type Variables = {
  userId: string;
  email: string;
};

const feedRoutes = new Hono<{ Variables: Variables }>();

/**
 * GET /:school_slug - Get school feed
 * Paginated list of public outfits from users at a school
 * Query params: cursor (worn_at timestamp), limit (default 20)
 */
feedRoutes.get("/:school_slug", async (c) => {
  const userId = getUserId(c);
  const schoolSlug = c.req.param("school_slug");
  const cursor = c.req.query("cursor"); // ISO timestamp for pagination
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 50);

  try {
    // Get school ID from slug
    const { data: school, error: schoolError } = await supabaseAdmin
      .from("schools")
      .select("id, name, short_name")
      .eq("slug", schoolSlug)
      .eq("is_active", true)
      .single();

    if (schoolError || !school) {
      return c.json({ error: "School not found" }, 404);
    }

    // Get user IDs belonging to this school
    const { data: schoolUsers, error: usersError } = await supabaseAdmin
      .from("user_profiles")
      .select("id")
      .eq("school_id", school.id);

    if (usersError) {
      console.error("[Feed] Failed to fetch school users:", usersError);
      return c.json({ error: "Failed to fetch feed" }, 500);
    }

    const userIds = schoolUsers?.map((u) => u.id) || [];

    if (userIds.length === 0) {
      return c.json({
        school: {
          id: school.id,
          name: school.name,
          short_name: school.short_name,
          slug: schoolSlug,
        },
        outfits: [],
        next_cursor: null,
        total: 0,
      });
    }

    // Build query for public outfits from school users
    let query = supabaseAdmin
      .from("outfit_history")
      .select(`
        id,
        user_id,
        items,
        outfit_id,
        outfit_name,
        occasion,
        photo_url,
        caption,
        vote_count,
        verification_type,
        worn_at,
        is_public
      `)
      .eq("is_public", true)
      .in("user_id", userIds)
      .order("worn_at", { ascending: false })
      .limit(limit + 1); // Fetch one extra to determine if there's more

    // Apply cursor for pagination
    if (cursor) {
      query = query.lt("worn_at", cursor);
    }

    const { data: outfits, error: feedError } = await query;

    if (feedError) {
      console.error("[Feed] Failed to fetch feed:", feedError);
      return c.json({ error: "Failed to fetch feed" }, 500);
    }

    // Check if there are more results
    const hasMore = outfits && outfits.length > limit;
    const results = hasMore ? outfits.slice(0, limit) : outfits || [];
    const nextCursor = hasMore ? results[results.length - 1]?.worn_at : null;

    // Get user profiles for the outfits
    const outfitUserIds = [...new Set(results.map((o) => o.user_id))];
    const { data: profiles } = await supabaseAdmin
      .from("user_profiles")
      .select("id, display_name, avatar_url, tier")
      .in("id", outfitUserIds);

    const profileMap = new Map(profiles?.map((p) => [p.id, p]) || []);

    // Get user's votes to show which outfits they've voted on
    const outfitIds = results.map((o) => o.id);
    const { data: userVotes } = await supabaseAdmin
      .from("votes")
      .select("outfit_history_id")
      .eq("user_id", userId)
      .in("outfit_history_id", outfitIds);

    const votedSet = new Set(userVotes?.map((v) => v.outfit_history_id) || []);

    // Get item images for outfits
    const allItemIds = results.flatMap((o) => o.items || []);
    const uniqueItemIds = [...new Set(allItemIds)];

    const { data: items } = await supabaseAdmin
      .from("wardrobe_items")
      .select("id, processed_image_url, category")
      .in("id", uniqueItemIds);

    const itemMap = new Map(items?.map((i) => [i.id, i]) || []);

    // Build enriched response
    const enrichedOutfits = results.map((outfit) => {
      const profile = profileMap.get(outfit.user_id);
      const outfitItems = (outfit.items || []).map((id: string) => itemMap.get(id)).filter(Boolean);

      return {
        id: outfit.id,
        outfit_id: outfit.outfit_id,
        outfit_name: outfit.outfit_name,
        occasion: outfit.occasion,
        photo_url: outfit.photo_url,
        caption: outfit.caption,
        vote_count: outfit.vote_count || 0,
        verification_type: outfit.verification_type,
        worn_at: outfit.worn_at,
        has_voted: votedSet.has(outfit.id),
        is_own: outfit.user_id === userId,
        user: profile
          ? {
              id: profile.id,
              display_name: profile.display_name,
              avatar_url: profile.avatar_url,
              tier: profile.tier,
            }
          : null,
        items: outfitItems.map((item: { id: string; processed_image_url: string; category: string }) => ({
          id: item.id,
          image_url: item.processed_image_url,
          category: item.category,
        })),
      };
    });

    return c.json({
      school: {
        id: school.id,
        name: school.name,
        short_name: school.short_name,
        slug: schoolSlug,
      },
      outfits: enrichedOutfits,
      next_cursor: nextCursor,
      total: enrichedOutfits.length,
    });
  } catch (error) {
    console.error("[Feed] Error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * POST /publish/:outfit_history_id - Publish an outfit to the school feed
 * Makes the outfit public and visible in the school feed
 * Body (optional): { caption?: string }
 */
feedRoutes.post("/publish/:outfit_history_id", async (c) => {
  const userId = getUserId(c);
  const outfitHistoryId = c.req.param("outfit_history_id");
  const body = await c.req.json().catch(() => ({}));
  const { caption } = body;

  try {
    // Verify the user owns this outfit history entry
    const { data: outfit, error: outfitError } = await supabaseAdmin
      .from("outfit_history")
      .select("id, user_id, is_public")
      .eq("id", outfitHistoryId)
      .eq("user_id", userId)
      .single();

    if (outfitError || !outfit) {
      return c.json({ error: "Outfit not found or not owned by user" }, 404);
    }

    if (outfit.is_public) {
      return c.json({ error: "Outfit is already published" }, 409);
    }

    // Verify user has a school set
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .select("school_id")
      .eq("id", userId)
      .single();

    if (profileError || !profile?.school_id) {
      return c.json({ error: "You must join a school before publishing outfits" }, 403);
    }

    // Update the outfit to be public
    const updates: Record<string, unknown> = {
      is_public: true,
    };

    if (caption !== undefined) {
      updates.caption = caption?.substring(0, 280) || null; // Limit caption length
    }

    const { error: updateError } = await supabaseAdmin
      .from("outfit_history")
      .update(updates)
      .eq("id", outfitHistoryId);

    if (updateError) {
      console.error("[Feed] Failed to publish outfit:", updateError);
      return c.json({ error: "Failed to publish outfit" }, 500);
    }

    console.log(`[Feed] User ${userId} published outfit ${outfitHistoryId}`);

    return c.json({
      success: true,
      message: "Outfit published to school feed",
    });
  } catch (error) {
    console.error("[Feed] Error publishing:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * DELETE /publish/:outfit_history_id - Unpublish an outfit from the feed
 * Makes the outfit private again
 */
feedRoutes.delete("/publish/:outfit_history_id", async (c) => {
  const userId = getUserId(c);
  const outfitHistoryId = c.req.param("outfit_history_id");

  try {
    // Verify the user owns this outfit history entry
    const { data: outfit, error: outfitError } = await supabaseAdmin
      .from("outfit_history")
      .select("id, user_id, is_public")
      .eq("id", outfitHistoryId)
      .eq("user_id", userId)
      .single();

    if (outfitError || !outfit) {
      return c.json({ error: "Outfit not found or not owned by user" }, 404);
    }

    if (!outfit.is_public) {
      return c.json({ error: "Outfit is not published" }, 409);
    }

    // Update the outfit to be private and clear caption
    const { error: updateError } = await supabaseAdmin
      .from("outfit_history")
      .update({
        is_public: false,
        caption: null,
        vote_count: 0, // Reset votes when unpublishing
      })
      .eq("id", outfitHistoryId);

    if (updateError) {
      console.error("[Feed] Failed to unpublish outfit:", updateError);
      return c.json({ error: "Failed to unpublish outfit" }, 500);
    }

    // Delete all votes for this outfit
    await supabaseAdmin
      .from("votes")
      .delete()
      .eq("outfit_history_id", outfitHistoryId);

    console.log(`[Feed] User ${userId} unpublished outfit ${outfitHistoryId}`);

    return c.json({
      success: true,
      message: "Outfit removed from school feed",
    });
  } catch (error) {
    console.error("[Feed] Error unpublishing:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * PATCH /publish/:outfit_history_id - Update a published outfit's caption
 * Body: { caption: string }
 */
feedRoutes.patch("/publish/:outfit_history_id", async (c) => {
  const userId = getUserId(c);
  const outfitHistoryId = c.req.param("outfit_history_id");
  const body = await c.req.json().catch(() => ({}));
  const { caption } = body;

  try {
    // Verify the user owns this outfit and it's public
    const { data: outfit, error: outfitError } = await supabaseAdmin
      .from("outfit_history")
      .select("id, user_id, is_public")
      .eq("id", outfitHistoryId)
      .eq("user_id", userId)
      .single();

    if (outfitError || !outfit) {
      return c.json({ error: "Outfit not found or not owned by user" }, 404);
    }

    if (!outfit.is_public) {
      return c.json({ error: "Outfit is not published" }, 403);
    }

    const { error: updateError } = await supabaseAdmin
      .from("outfit_history")
      .update({
        caption: caption?.substring(0, 280) || null,
      })
      .eq("id", outfitHistoryId);

    if (updateError) {
      console.error("[Feed] Failed to update caption:", updateError);
      return c.json({ error: "Failed to update caption" }, 500);
    }

    return c.json({
      success: true,
      message: "Caption updated",
    });
  } catch (error) {
    console.error("[Feed] Error updating caption:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default feedRoutes;

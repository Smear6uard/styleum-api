/**
 * Feed Routes - Protected Endpoints
 * School feed and outfit publishing
 */

import { Hono } from "hono";
import { supabaseAdmin } from "../services/supabase.js";
import { getUserId } from "../middleware/auth.js";
import { GamificationService, XP_AMOUNTS } from "../services/gamification.js";

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

/**
 * POST /upload - Upload image for a direct feed post
 * Accepts multipart FormData with 'image' field
 * Returns public URL to be used in /post endpoint
 */
feedRoutes.post("/upload", async (c) => {
  const userId = getUserId(c);

  try {
    const formData = await c.req.formData();
    const imageFile = formData.get("image") as File | null;

    if (!imageFile) {
      return c.json({ error: "No image provided" }, 400);
    }

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic"];
    if (!allowedTypes.includes(imageFile.type)) {
      return c.json(
        { error: "Invalid file type. Allowed: JPEG, PNG, WebP, HEIC" },
        400
      );
    }

    // Upload to outfit-verifications bucket under posts/{userId}/{timestamp}.{ext}
    const fileExt = imageFile.name.split(".").pop() || "jpg";
    const fileName = `posts/${userId}/${Date.now()}.${fileExt}`;
    const fileBuffer = await imageFile.arrayBuffer();

    const { error: uploadError } = await supabaseAdmin.storage
      .from("outfit-verifications")
      .upload(fileName, fileBuffer, {
        contentType: imageFile.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("[Feed] Failed to upload image:", uploadError);
      return c.json({ error: "Failed to upload image" }, 500);
    }

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from("outfit-verifications")
      .getPublicUrl(fileName);

    console.log(`[Feed] User ${userId} uploaded post image: ${fileName}`);

    return c.json({
      url: urlData.publicUrl,
    });
  } catch (error) {
    console.error("[Feed] Error uploading image:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * POST /post - Create a direct photo post to the school feed
 * Body: { photo_url: string, caption?: string, item_ids?: string[] }
 * Creates a public outfit_history entry without requiring AI-generated outfits
 */
feedRoutes.post("/post", async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => ({}));
  const { photo_url, caption, item_ids } = body;

  try {
    // Validate required fields
    if (!photo_url || typeof photo_url !== "string") {
      return c.json({ error: "photo_url is required" }, 400);
    }

    // Validate caption length
    if (caption && caption.length > 280) {
      return c.json({ error: "Caption must be 280 characters or less" }, 400);
    }

    // Validate item_ids if provided
    if (item_ids && !Array.isArray(item_ids)) {
      return c.json({ error: "item_ids must be an array" }, 400);
    }

    // Verify user has a school set
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .select("school_id")
      .eq("id", userId)
      .single();

    if (profileError || !profile?.school_id) {
      return c.json({ error: "You must join a school before posting to the feed" }, 403);
    }

    // If item_ids provided, verify they belong to the user
    if (item_ids && item_ids.length > 0) {
      const { data: items, error: itemsError } = await supabaseAdmin
        .from("wardrobe_items")
        .select("id")
        .eq("user_id", userId)
        .in("id", item_ids);

      if (itemsError) {
        console.error("[Feed] Failed to verify items:", itemsError);
        return c.json({ error: "Failed to verify wardrobe items" }, 500);
      }

      const foundIds = new Set(items?.map((i) => i.id) || []);
      const missingIds = item_ids.filter((id: string) => !foundIds.has(id));
      if (missingIds.length > 0) {
        return c.json({ error: "Some wardrobe items not found or not owned by user" }, 400);
      }
    }

    // Create outfit_history entry
    const { data: post, error: insertError } = await supabaseAdmin
      .from("outfit_history")
      .insert({
        user_id: userId,
        items: item_ids || [],
        photo_url,
        caption: caption?.substring(0, 280) || null,
        is_public: true,
        is_verified: true,
        verification_type: "photo",
        worn_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error("[Feed] Failed to create post:", insertError);
      return c.json({ error: "Failed to create post" }, 500);
    }

    // Award XP for sharing
    await GamificationService.awardXP(
      userId,
      XP_AMOUNTS.SHARE_OUTFIT,
      "share_outfit",
      post.id,
      "Posted to school feed"
    );

    console.log(`[Feed] User ${userId} created direct post ${post.id}`);

    return c.json({
      success: true,
      post: {
        id: post.id,
        photo_url: post.photo_url,
        caption: post.caption,
        item_ids: post.items,
        worn_at: post.worn_at,
        is_public: post.is_public,
      },
    });
  } catch (error) {
    console.error("[Feed] Error creating post:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default feedRoutes;

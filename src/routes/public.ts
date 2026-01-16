/**
 * Public Routes - No Authentication Required
 * Used for public outfit sharing pages and OpenGraph metadata
 */

import { Hono } from "hono";
import { supabaseAdmin } from "../services/supabase.js";

const publicRoutes = new Hono();

/**
 * GET /outfits/:id - Public outfit view for share pages
 * NO AUTHENTICATION - This is publicly accessible
 */
publicRoutes.get("/outfits/:id", async (c) => {
  const outfitId = c.req.param("id");

  try {
    // Try to find by short_id first, then by full UUID
    let query = supabaseAdmin
      .from("generated_outfits")
      .select(`
        id,
        short_id,
        user_id,
        outfit_name,
        vibe,
        reasoning,
        confidence_score,
        occasion,
        mood,
        items,
        weather_condition,
        weather_temp,
        generated_at
      `);

    // Check if it's a short ID (8 chars) or full UUID (36 chars)
    if (outfitId.length <= 8) {
      query = query.eq("short_id", outfitId);
    } else {
      query = query.eq("id", outfitId);
    }

    const { data: outfit, error } = await query.single();

    if (error || !outfit) {
      return c.json(
        {
          error: "Outfit not found",
          message: "This outfit may have been removed or the link is invalid.",
        },
        404
      );
    }

    // Increment view count (fire-and-forget, don't block response)
    void supabaseAdmin
      .rpc("increment_outfit_view_count", { p_outfit_id: outfit.id })
      .then(() => {}, () => {}); // Ignore errors silently

    // Fetch user's first name for "styled by" attribution
    const { data: userProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("first_name")
      .eq("id", outfit.user_id)
      .single();

    // Fetch items - PUBLIC INFO ONLY (no user data, no private fields)
    const { data: items } = await supabaseAdmin
      .from("wardrobe_items")
      .select(`
        id,
        item_name,
        category,
        subcategory,
        colors,
        processed_image_url,
        brand
      `)
      .in("id", outfit.items || []);

    // Transform to public-safe response
    const publicOutfit = {
      id: outfit.short_id || outfit.id,
      name: outfit.outfit_name || "Styled Outfit",
      vibe: outfit.vibe,
      headline: outfit.reasoning?.split(".")[0] || outfit.vibe, // First sentence as headline
      style_score: Math.round((outfit.confidence_score || 0) * 100),
      occasion: outfit.occasion,
      mood: outfit.mood,
      weather: outfit.weather_condition
        ? {
            condition: outfit.weather_condition,
            temp: outfit.weather_temp,
          }
        : null,
      generated_at: outfit.generated_at,
      styled_by: userProfile?.first_name || null,
    };

    const publicItems = (items || []).map((item) => ({
      id: item.id,
      name: item.item_name,
      category: item.category,
      subcategory: item.subcategory,
      color: item.colors?.primary || null,
      image_url: item.processed_image_url,
      brand: item.brand,
    }));

    return c.json({
      outfit: publicOutfit,
      items: publicItems,
      app_store_url: "https://apps.apple.com/app/styleum/id123456789", // TODO: Update with real ID
      website_url: "https://styleum.xyz",
    });
  } catch (error) {
    console.error("[Public] Error fetching outfit:", error);
    return c.json({ error: "Failed to load outfit" }, 500);
  }
});

/**
 * GET /outfits/:id/og - OpenGraph metadata for link previews
 * Returns metadata for generating preview images
 */
publicRoutes.get("/outfits/:id/og", async (c) => {
  const outfitId = c.req.param("id");

  try {
    let query = supabaseAdmin
      .from("generated_outfits")
      .select(`
        id,
        short_id,
        outfit_name,
        vibe,
        confidence_score,
        items
      `);

    if (outfitId.length <= 8) {
      query = query.eq("short_id", outfitId);
    } else {
      query = query.eq("id", outfitId);
    }

    const { data: outfit, error } = await query.single();

    if (error || !outfit) {
      return c.json({ error: "Not found" }, 404);
    }

    // Get first item image for OG preview
    const { data: items } = await supabaseAdmin
      .from("wardrobe_items")
      .select("processed_image_url")
      .in("id", outfit.items || [])
      .limit(1);

    return c.json({
      title: outfit.outfit_name || "Outfit on Styleum",
      description: outfit.vibe || "Check out this outfit styled with Styleum",
      score: Math.round((outfit.confidence_score || 0) * 100),
      preview_image: items?.[0]?.processed_image_url || null,
      url: `https://styleum.xyz/o/${outfit.short_id || outfit.id}`,
    });
  } catch (error) {
    console.error("[Public] OG error:", error);
    return c.json({ error: "Failed" }, 500);
  }
});

export default publicRoutes;

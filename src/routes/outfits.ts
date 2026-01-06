import { Hono } from "hono";
import { supabaseAdmin, isUserPro } from "../services/supabase.js";
import { checkCreditLimit } from "../utils/limits.js";
import { getUserId } from "../middleware/auth.js";
import {
  styleMeLimitMiddleware,
  checkStyleMeLimit,
} from "../middleware/rateLimit.js";
import {
  generateOutfits,
  saveGeneratedOutfit,
  recordOutfitInteraction,
  AVAILABLE_MOODS,
  type GenerationConstraints,
} from "../services/outfitGenerator.js";
import { updateTasteVector } from "../services/tasteVector.js";
import type { WeatherData } from "../services/weather.js";

/**
 * Convert Celsius to Fahrenheit
 */
function celsiusToFahrenheit(celsius: number): number {
  return Math.round((celsius * 9 / 5) + 32);
}

/**
 * Format weather data for API response (iOS expects Fahrenheit)
 */
function formatWeatherResponse(weather: WeatherData) {
  return {
    temp_fahrenheit: celsiusToFahrenheit(weather.temperature),
    condition: weather.condition,
    humidity: weather.humidity,
    wind_mph: Math.round(weather.wind_speed * 2.237 * 10) / 10, // m/s to mph
    description: weather.description,
  };
}

/**
 * Get the role/slot for an item based on its category
 */
function getItemRole(category: string | null | undefined): string {
  const cat = (category || "").toLowerCase();

  // Tops
  if (["t-shirt", "shirt", "blouse", "sweater", "hoodie", "tank-top", "polo", "top", "tee", "henley", "cardigan", "tank"].includes(cat)) {
    return "top";
  }
  // Bottoms
  if (["jeans", "pants", "trousers", "shorts", "skirt", "chinos", "joggers", "bottom", "slacks", "leggings"].includes(cat)) {
    return "bottom";
  }
  // Footwear
  if (["sneakers", "shoes", "boots", "sandals", "loafers", "heels", "footwear", "flats", "oxfords"].includes(cat)) {
    return "footwear";
  }
  // Outerwear
  if (["jacket", "coat", "blazer", "vest", "outerwear", "parka", "windbreaker"].includes(cat)) {
    return "outerwear";
  }
  // Default to accessory
  return "accessory";
}

/**
 * Transform outfit to iOS-expected format
 */
interface OutfitItem {
  id: string;
  category?: string | null;
  subcategory?: string | null;
  processed_image_url?: string | null;
  original_image_url?: string | null;
  colors?: unknown;
  item_name?: string | null;
}

interface GeneratedOutfitData {
  id?: string | null;
  item_ids: string[];
  name: string;
  vibe: string;
  reasoning: string;
  styling_tip?: string;
  color_harmony_description?: string;
  style_score: number;
  confidence_score: number;
  occasion_match?: boolean;
}

function transformOutfitForIOS(
  outfit: GeneratedOutfitData,
  items: OutfitItem[],
  outfitId: string
) {
  return {
    id: outfitId,
    wardrobeItemIds: outfit.item_ids,
    score: Math.round((outfit.style_score || 0.8) * 100),
    headline: outfit.name,
    vibe: outfit.vibe,
    whyItWorks: outfit.reasoning,
    stylingTip: outfit.styling_tip || null,
    colorHarmony: outfit.color_harmony_description || null,
    occasion: outfit.occasion_match ? "matched" : null,
    vibes: [outfit.vibe].filter(Boolean),
    items: items.map((item) => ({
      id: item.id,
      role: getItemRole(item.category || item.subcategory),
      imageUrl: item.processed_image_url || item.original_image_url,
      category: item.category,
      subcategory: item.subcategory,
      colors: item.colors,
      itemName: item.item_name,
    })),
  };
}

type Variables = {
  userId: string;
  email: string;
};

const outfits = new Hono<{ Variables: Variables }>();

/**
 * GET / - Get cached outfits (not expired)
 */
outfits.get("/", async (c) => {
  const userId = getUserId(c);
  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("generated_outfits")
    .select("*")
    .eq("user_id", userId)
    .gt("expires_at", now)
    .order("style_score", { ascending: false, nullsFirst: false });

  if (error) {
    return c.json({ error: "Failed to fetch outfits" }, 500);
  }

  // Transform cached outfits for iOS format
  const transformedOutfits = await Promise.all(
    (data || []).map(async (outfit) => {
      const { data: items } = await supabaseAdmin
        .from("wardrobe_items")
        .select(
          "id, category, subcategory, processed_image_url, original_image_url, colors, item_name"
        )
        .in("id", outfit.items || []);

      // Map database outfit to GeneratedOutfitData format
      const outfitData = {
        id: outfit.id,
        item_ids: outfit.items || [],
        name: outfit.outfit_name || "Styled Outfit",
        vibe: outfit.vibe || "Casual",
        reasoning: outfit.reasoning || "",
        styling_tip: undefined,
        color_harmony_description: undefined,
        style_score: outfit.style_score || 0.8,
        confidence_score: outfit.confidence_score || 0.8,
        occasion_match: false,
      };

      return transformOutfitForIOS(outfitData, items || [], outfit.id);
    })
  );

  return c.json({ outfits: transformedOutfits });
});

/**
 * POST /generate - Generate outfits (Style Me)
 * Uses monthly rate limits: Free = 5/month, Pro = 75/month
 */
outfits.post("/generate", styleMeLimitMiddleware, async (c) => {
  const userId = getUserId(c);

  const body = await c.req.json().catch(() => ({}));
  const { occasion, mood, lat, lon, count = 3 } = body;

  // Mood filtering is Pro-only
  const isPro = await isUserPro(userId);
  const effectiveMood = isPro ? mood : undefined;

  console.log(`[Outfits] Generate request - lat: ${lat}, lon: ${lon}, occasion: ${occasion}`);

  // Generate outfits using AI-powered generator
  const { outfits: generatedOutfits, weather } = await generateOutfits({
    userId,
    occasion,
    mood: effectiveMood,
    lat,
    lon,
    count: Math.min(count, 5), // Max 5 outfits per generation
  });

  console.log(`[Outfits] Weather: ${weather.temperature}C (${celsiusToFahrenheit(weather.temperature)}F), ${weather.condition}`);

  if (generatedOutfits.length === 0) {
    return c.json(
      {
        error: "Could not generate outfits",
        message: "You need at least 3 items (top, bottom, footwear) in your wardrobe",
      },
      400
    );
  }

  // Save outfits to database
  const savedOutfits = await Promise.all(
    generatedOutfits.map(async (outfit) => {
      const outfitId = await saveGeneratedOutfit(userId, outfit, occasion, weather);
      return {
        id: outfitId,
        ...outfit,
      };
    })
  );

  // Transform outfits for iOS format
  const transformedOutfits = await Promise.all(
    savedOutfits.map(async (outfit) => {
      const { data: items } = await supabaseAdmin
        .from("wardrobe_items")
        .select(
          "id, category, subcategory, processed_image_url, original_image_url, colors, item_name"
        )
        .in("id", outfit.item_ids);

      return transformOutfitForIOS(outfit, items || [], outfit.id || "");
    })
  );

  // Get updated credit info
  const creditInfo = await checkStyleMeLimit(userId);

  console.log(`[Outfits] Generated ${transformedOutfits.length} outfits`);

  return c.json({
    outfits: transformedOutfits,
    count: transformedOutfits.length,
    weather: formatWeatherResponse(weather),
    credits: {
      remaining: creditInfo.remaining,
      used: creditInfo.used,
      limit: creditInfo.limit,
      resetsAt: creditInfo.resetsAt.toISOString(),
    },
  });
});

/**
 * POST /:id/wear - Mark outfit as worn
 */
outfits.post("/:id/wear", async (c) => {
  const userId = getUserId(c);
  const outfitId = c.req.param("id");

  const body = await c.req.json().catch(() => ({}));
  const { photo_url } = body;

  // Get the outfit to verify ownership and get items
  const { data: outfit, error: outfitError } = await supabaseAdmin
    .from("generated_outfits")
    .select("*")
    .eq("id", outfitId)
    .eq("user_id", userId)
    .single();

  if (outfitError || !outfit) {
    return c.json({ error: "Outfit not found" }, 404);
  }

  // Base XP for wearing an outfit is 25
  const xpAwarded = 25;

  // Add to outfit history
  const { error: historyError } = await supabaseAdmin
    .from("outfit_history")
    .insert({
      user_id: userId,
      outfit_id: outfitId,
      items: outfit.items,
      occasion: outfit.occasion,
      worn_at: new Date().toISOString(),
      photo_url: photo_url ?? null,
      xp_awarded: xpAwarded,
    });

  if (historyError) {
    console.error("[Outfits] Failed to record outfit wear:", historyError);
    return c.json({ error: "Failed to record outfit wear" }, 500);
  }

  // Update item stats (times_worn and last_worn_at)
  if (outfit.items && outfit.items.length > 0) {
    const now = new Date().toISOString();
    for (const itemId of outfit.items) {
      await supabaseAdmin.rpc("increment_times_worn", {
        item_id: itemId,
        worn_date: now,
      });
    }
  }

  // Update user gamification XP
  await supabaseAdmin.rpc("add_user_xp", {
    p_user_id: userId,
    p_xp: xpAwarded,
  });

  // Record interaction for taste vector learning
  await recordOutfitInteraction(userId, outfitId, "wear");

  // Mark outfit as worn
  await supabaseAdmin
    .from("generated_outfits")
    .update({ is_worn: true })
    .eq("id", outfitId);

  return c.json({
    success: true,
    xp_awarded: xpAwarded,
    message: "Outfit marked as worn! Use /verify to add photo proof for bonus XP.",
  });
});

/**
 * POST /:id/save - Save outfit permanently
 */
outfits.post("/:id/save", async (c) => {
  const userId = getUserId(c);
  const outfitId = c.req.param("id");

  const body = await c.req.json().catch(() => ({}));
  const { outfit_name, notes } = body;

  // Get the outfit
  const { data: outfit, error: outfitError } = await supabaseAdmin
    .from("generated_outfits")
    .select("*")
    .eq("id", outfitId)
    .eq("user_id", userId)
    .single();

  if (outfitError || !outfit) {
    return c.json({ error: "Outfit not found" }, 404);
  }

  // Save to saved_outfits table
  const { data: saved, error: saveError } = await supabaseAdmin
    .from("saved_outfits")
    .insert({
      user_id: userId,
      original_outfit_id: outfitId,
      items: outfit.items,
      outfit_name: outfit_name || outfit.outfit_name || null,
      occasion: outfit.occasion,
      notes: notes || null,
      style_score: outfit.style_score,
    })
    .select()
    .single();

  if (saveError) {
    console.error("[Outfits] Failed to save outfit:", saveError);
    return c.json({ error: "Failed to save outfit" }, 500);
  }

  // Mark generated outfit as saved
  await supabaseAdmin
    .from("generated_outfits")
    .update({ is_saved: true })
    .eq("id", outfitId);

  // Record interaction for taste vector learning
  await recordOutfitInteraction(userId, outfitId, "save");

  return c.json({
    success: true,
    saved_outfit: saved,
  });
});

/**
 * POST /:id/like - Like an outfit (positive signal without wearing)
 */
outfits.post("/:id/like", async (c) => {
  const userId = getUserId(c);
  const outfitId = c.req.param("id");

  // Verify outfit exists and belongs to user
  const { data: outfit } = await supabaseAdmin
    .from("generated_outfits")
    .select("id")
    .eq("id", outfitId)
    .eq("user_id", userId)
    .single();

  if (!outfit) {
    return c.json({ error: "Outfit not found" }, 404);
  }

  // Record interaction for taste vector learning
  await recordOutfitInteraction(userId, outfitId, "like");

  return c.json({ success: true });
});

/**
 * POST /:id/skip - Skip/reject an outfit (negative signal)
 */
outfits.post("/:id/skip", async (c) => {
  const userId = getUserId(c);
  const outfitId = c.req.param("id");

  // Verify outfit exists and belongs to user
  const { data: outfit } = await supabaseAdmin
    .from("generated_outfits")
    .select("id")
    .eq("id", outfitId)
    .eq("user_id", userId)
    .single();

  if (!outfit) {
    return c.json({ error: "Outfit not found" }, 404);
  }

  // Record interaction for taste vector learning
  await recordOutfitInteraction(userId, outfitId, "skip");

  return c.json({ success: true });
});

/**
 * POST /:id/reject - Explicitly reject an outfit (strong negative signal)
 */
outfits.post("/:id/reject", async (c) => {
  const userId = getUserId(c);
  const outfitId = c.req.param("id");

  // Verify outfit exists and belongs to user
  const { data: outfit } = await supabaseAdmin
    .from("generated_outfits")
    .select("id")
    .eq("id", outfitId)
    .eq("user_id", userId)
    .single();

  if (!outfit) {
    return c.json({ error: "Outfit not found" }, 404);
  }

  // Record interaction for taste vector learning
  await recordOutfitInteraction(userId, outfitId, "reject");

  // Delete the outfit from cache
  await supabaseAdmin
    .from("generated_outfits")
    .delete()
    .eq("id", outfitId);

  return c.json({ success: true });
});

/**
 * GET /saved - Get saved outfits
 */
outfits.get("/saved", async (c) => {
  const userId = getUserId(c);

  const { data, error } = await supabaseAdmin
    .from("saved_outfits")
    .select("*")
    .eq("user_id", userId)
    .order("saved_at", { ascending: false });

  if (error) {
    return c.json({ error: "Failed to fetch saved outfits" }, 500);
  }

  // Transform saved outfits for iOS format
  const transformedOutfits = await Promise.all(
    (data || []).map(async (outfit) => {
      const { data: items } = await supabaseAdmin
        .from("wardrobe_items")
        .select(
          "id, category, subcategory, processed_image_url, original_image_url, colors, item_name"
        )
        .in("id", outfit.items || []);

      // Map saved outfit to GeneratedOutfitData format
      const outfitData = {
        id: outfit.id,
        item_ids: outfit.items || [],
        name: outfit.outfit_name || "Saved Outfit",
        vibe: "Saved",
        reasoning: outfit.notes || "",
        styling_tip: undefined,
        color_harmony_description: undefined,
        style_score: outfit.style_score || 0.8,
        confidence_score: 0.9,
        occasion_match: false,
      };

      return transformOutfitForIOS(outfitData, items || [], outfit.id);
    })
  );

  return c.json({ outfits: transformedOutfits });
});

/**
 * DELETE /saved/:id - Delete a saved outfit
 */
outfits.delete("/saved/:id", async (c) => {
  const userId = getUserId(c);
  const savedOutfitId = c.req.param("id");

  const { error } = await supabaseAdmin
    .from("saved_outfits")
    .delete()
    .eq("id", savedOutfitId)
    .eq("user_id", userId);

  if (error) {
    return c.json({ error: "Failed to delete saved outfit" }, 500);
  }

  return c.body(null, 204);
});

/**
 * GET /history - Get outfit history with pagination
 */
outfits.get("/history", async (c) => {
  const userId = getUserId(c);
  const page = parseInt(c.req.query("page") ?? "1");
  const limit = parseInt(c.req.query("limit") ?? "20");
  const offset = (page - 1) * limit;

  const { data, error, count } = await supabaseAdmin
    .from("outfit_history")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("worn_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return c.json({ error: "Failed to fetch history" }, 500);
  }

  // Enrich with item details
  const enrichedHistory = await Promise.all(
    (data || []).map(async (entry) => {
      const { data: items } = await supabaseAdmin
        .from("wardrobe_items")
        .select(
          "id, category, subcategory, processed_image_url, original_image_url, colors, item_name"
        )
        .in("id", entry.items || []);

      return {
        ...entry,
        item_details: items || [],
      };
    })
  );

  return c.json({
    history: enrichedHistory,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / limit),
    },
  });
});

/**
 * POST /regenerate - Regenerate outfits with feedback (Pro-only)
 * Unlimited regenerations for Pro users (don't count against monthly limit)
 */
outfits.post("/regenerate", async (c) => {
  const userId = getUserId(c);

  // Check Pro status
  const isPro = await isUserPro(userId);
  if (!isPro) {
    return c.json(
      {
        error: "Pro subscription required",
        code: "E003",
        message: "Regeneration is a Pro feature. Upgrade to get unlimited regenerations.",
        upgradeUrl: "/pro",
      },
      403
    );
  }

  const body = await c.req.json().catch(() => ({}));
  const {
    feedback,
    occasion,
    mood,
    lat,
    lon,
    count = 3,
    previousOutfitIds = [],
  } = body;

  // Build constraints from feedback type
  let constraints: GenerationConstraints = {};

  // Collect all item IDs from previous outfits to exclude
  if (previousOutfitIds.length > 0) {
    const { data: prevOutfits } = await supabaseAdmin
      .from("generated_outfits")
      .select("items")
      .in("id", previousOutfitIds);

    const prevItemIds = prevOutfits?.flatMap((o) => o.items || []) || [];
    constraints.excludeItemIds = prevItemIds;
  }

  // Apply feedback-specific constraints
  switch (feedback) {
    case "more_bold":
      constraints.preferVibes = ["edgy", "bold", "streetwear", "colorful"];
      break;
    case "more_casual":
      constraints.maxFormality = 4;
      constraints.preferVibes = ["casual", "relaxed", "bohemian"];
      break;
    case "more_formal":
      constraints.minFormality = 6;
      constraints.preferVibes = ["classic", "polished", "minimalist"];
      break;
    case "different_colors":
      constraints.avoidColors = true;
      break;
    case "swap_top":
      constraints.mustSwapSlots = ["top"];
      break;
    case "swap_bottom":
      constraints.mustSwapSlots = ["bottom"];
      break;
    case "swap_shoes":
      constraints.mustSwapSlots = ["footwear"];
      break;
    case "completely_different":
      constraints.excludeAllPreviousItems = true;
      break;
  }

  // Generate outfits with constraints
  const { outfits: generatedOutfits, weather } = await generateOutfits({
    userId,
    occasion,
    mood,
    lat,
    lon,
    count: Math.min(count, 5),
    constraints,
  });

  if (generatedOutfits.length === 0) {
    return c.json(
      {
        error: "Could not generate outfits",
        message: "Try different feedback or add more items to your wardrobe.",
      },
      400
    );
  }

  // Save outfits to database
  const savedOutfits = await Promise.all(
    generatedOutfits.map(async (outfit) => {
      const outfitId = await saveGeneratedOutfit(userId, outfit, occasion, weather);
      return {
        id: outfitId,
        ...outfit,
      };
    })
  );

  // Transform outfits for iOS format
  const transformedOutfits = await Promise.all(
    savedOutfits.map(async (outfit) => {
      const { data: items } = await supabaseAdmin
        .from("wardrobe_items")
        .select(
          "id, category, subcategory, processed_image_url, original_image_url, colors, item_name"
        )
        .in("id", outfit.item_ids);

      return transformOutfitForIOS(outfit, items || [], outfit.id || "");
    })
  );

  return c.json({
    outfits: transformedOutfits,
    count: transformedOutfits.length,
    weather: formatWeatherResponse(weather),
    feedback_applied: feedback,
  });
});

/**
 * POST /:id/verify - Verify outfit with photo proof
 * Awards +25 bonus XP (total 50 XP for verified outfit)
 */
outfits.post("/:id/verify", async (c) => {
  const userId = getUserId(c);
  const outfitId = c.req.param("id");

  // Check if outfit exists in history and belongs to user
  const { data: historyEntry, error: historyError } = await supabaseAdmin
    .from("outfit_history")
    .select("*")
    .eq("outfit_id", outfitId)
    .eq("user_id", userId)
    .single();

  if (historyError || !historyEntry) {
    return c.json({ error: "Outfit not found in history. Mark as worn first." }, 404);
  }

  // Check if already verified
  if (historyEntry.is_verified) {
    return c.json({ error: "Outfit already verified" }, 400);
  }

  // Parse multipart form data for photo
  const formData = await c.req.formData().catch(() => null);
  if (!formData) {
    return c.json({ error: "Photo required for verification" }, 400);
  }

  const photoFile = formData.get("photo") as File | null;
  if (!photoFile) {
    return c.json({ error: "Photo file is required" }, 400);
  }

  // Validate file type
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/heic"];
  if (!allowedTypes.includes(photoFile.type)) {
    return c.json(
      { error: "Invalid file type. Allowed: JPEG, PNG, WebP, HEIC" },
      400
    );
  }

  // Upload photo to outfit-verifications bucket
  const fileExt = photoFile.name.split(".").pop() || "jpg";
  const fileName = `${userId}/${outfitId}_${Date.now()}.${fileExt}`;
  const fileBuffer = await photoFile.arrayBuffer();

  const { error: uploadError } = await supabaseAdmin.storage
    .from("outfit-verifications")
    .upload(fileName, fileBuffer, {
      contentType: photoFile.type,
      upsert: false,
    });

  if (uploadError) {
    console.error("[Outfits] Failed to upload verification photo:", uploadError);
    return c.json({ error: "Failed to upload photo" }, 500);
  }

  // Get public URL
  const { data: urlData } = supabaseAdmin.storage
    .from("outfit-verifications")
    .getPublicUrl(fileName);

  const photoUrl = urlData.publicUrl;

  // Update outfit history with verification
  const { error: updateError } = await supabaseAdmin
    .from("outfit_history")
    .update({
      is_verified: true,
      photo_url: photoUrl,
    })
    .eq("id", historyEntry.id);

  if (updateError) {
    console.error("[Outfits] Failed to update verification:", updateError);
    return c.json({ error: "Failed to verify outfit" }, 500);
  }

  // Award bonus XP (25 XP for verification, on top of 25 XP from wearing)
  const bonusXp = 25;
  await supabaseAdmin.rpc("add_user_xp", {
    p_user_id: userId,
    p_xp: bonusXp,
  });

  return c.json({
    success: true,
    photo_url: photoUrl,
    bonus_xp_awarded: bonusXp,
    total_xp_for_outfit: 50, // 25 base + 25 bonus
    message: "Outfit verified! +25 bonus XP awarded.",
  });
});

/**
 * GET /moods - Get available mood options
 */
outfits.get("/moods", async (c) => {
  const userId = getUserId(c);
  const isPro = await isUserPro(userId);

  return c.json({
    moods: AVAILABLE_MOODS,
    pro_required: !isPro,
    message: isPro
      ? "Select a mood to filter outfit suggestions"
      : "Mood filtering is a Pro feature. Upgrade to unlock personalized moods.",
  });
});

export default outfits;

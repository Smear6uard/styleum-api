import { Hono } from "hono";
import { supabaseAdmin } from "../services/supabase.js";
import { checkItemLimit, FREE_ITEM_LIMIT } from "../utils/limits.js";
import { getUserId } from "../middleware/auth.js";
import { itemUploadLimit } from "../middleware/rateLimit.js";
import {
  removeBackground,
  generateEmbedding,
  analyzeWithFlorence,
  tagWithGemini,
} from "../services/ai/index.js";
import {
  GamificationService,
  XP_AMOUNTS,
} from "../services/gamification.js";
import { ReferralService } from "../services/referrals.js";
import { checkAndGenerateFirstOutfit } from "../services/firstOutfit.js";
import { hasAIConsent } from "../middleware/aiConsent.js";

type Variables = {
  userId: string;
  email: string;
};

const items = new Hono<{ Variables: Variables }>();

/**
 * Extract storage path from a Supabase storage public URL
 */
function extractStoragePath(url: string, bucket: string): string | null {
  try {
    const urlObj = new URL(url);
    // URL format: .../storage/v1/object/public/{bucket}/{path}
    const match = urlObj.pathname.match(
      new RegExp(`/storage/v1/object/public/${bucket}/(.+)`)
    );
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/**
 * Map database row to API response format (ensures snake_case)
 * Transforms AI fields to match Swift model expectations
 */
function mapItemToResponse(row: Record<string, unknown>) {
  // Extract colors object
  const colors = row.colors as {
    primary?: string;
    secondary?: string[];
    accent?: string;
  } | null;

  // Extract style_vibes array
  const styleVibes = row.style_vibes as string[] | null;

  // Extract materials array
  const materials = row.materials as string[] | null;

  return {
    id: row.id,
    user_id: row.user_id,
    original_image_url: row.original_image_url,
    processed_image_url: row.processed_image_url,
    thumbnail_url: row.thumbnail_url,
    category: row.category,
    subcategory: row.subcategory,
    item_name: row.item_name,

    // Transform colors object to separate fields for Swift
    primary_color: colors?.primary ?? null,
    secondary_colors: colors?.secondary ?? null,
    color_hex: null, // Not stored in DB

    // Transform formality_score to formality for Swift
    formality: row.formality_score,

    // Style vibes array and first vibe as style_bucket
    style_vibes: styleVibes ?? null,
    style_bucket: styleVibes?.[0] ?? null,

    // Transform materials array to material string for Swift
    material: materials?.join(", ") ?? null,

    // Keep these as-is (Swift expects same names)
    pattern: row.pattern,
    occasions: row.occasions,
    seasons: row.seasons,
    brand: row.brand,
    times_worn: row.times_worn,
    last_worn_at: row.last_worn_at,
    is_archived: row.is_archived,
    processing_status: row.processing_status,
    processing_error: row.processing_error,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/**
 * Process an item in the background:
 * Stage 2: Remove background (BiRefNet)
 * Stage 3: Vision analysis (Florence-2)
 * Stage 4: Generate embedding (FashionSigLIP)
 * Stage 5: Reasoning & tagging (Gemini)
 * Stage 6: Update item in database
 */
async function processItemInBackground(
  itemId: string,
  imageUrl: string,
  userId: string
): Promise<void> {
  try {
    console.log(`[AI] Processing item ${itemId}`);

    // Stage 2: Remove background
    const processedImageUrl = await removeBackground(imageUrl, itemId);
    console.log(`[AI] Background removed for ${itemId}`);

    // Stage 3: Vision analysis
    const vision = await analyzeWithFlorence(processedImageUrl);
    console.log(`[AI] Vision analysis complete for ${itemId}`);

    // Stage 4: Generate embedding from processed image
    const embedding = await generateEmbedding(processedImageUrl);
    console.log(`[AI] Embedding generated for ${itemId}`);

    // Stage 5: Reasoning & tagging
    const tags = await tagWithGemini(
      vision.raw_description,
      vision.extracted_colors
    );
    console.log(`[AI] Tagging complete for ${itemId}`);

    // Stage 6: Update item with ALL fields
    const { error } = await supabaseAdmin
      .from("wardrobe_items")
      .update({
        processed_image_url: processedImageUrl,
        embedding,
        category: tags.category,
        subcategory: tags.subcategory,
        colors: tags.colors,
        pattern: tags.pattern,
        materials: tags.materials,
        occasions: tags.occasions,
        seasons: tags.seasons,
        formality_score: tags.formality_score,
        style_vibes: tags.style_vibes,
        brand: tags.brand,
        gender: tags.gender,
        processing_status: "completed",
      })
      .eq("id", itemId);

    if (error) {
      throw new Error(`Failed to update item: ${error.message}`);
    }

    console.log(`[AI] Item ${itemId} processing completed`);

    // Check if this completes the wardrobe for first outfit generation
    try {
      await checkAndGenerateFirstOutfit(userId);
    } catch (firstOutfitError) {
      console.error("[AI] First outfit check failed:", firstOutfitError);
      // Don't fail item processing if first outfit check fails
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`[AI] Error processing item ${itemId}:`, errorMessage);

    // Update item with error status
    await supabaseAdmin
      .from("wardrobe_items")
      .update({
        processing_status: "failed",
        processing_error: errorMessage,
      })
      .eq("id", itemId);
  }
}

// GET / - Fetch user's wardrobe (non-archived, ordered by created_at desc)
items.get("/", async (c) => {
  const userId = getUserId(c);

  const { data, error } = await supabaseAdmin
    .from("wardrobe_items")
    .select("*")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .order("created_at", { ascending: false });

  if (error) {
    return c.json({ error: "Failed to fetch items" }, 500);
  }

  return c.json({ items: data?.map(mapItemToResponse) ?? [] });
});

// GET /insights - Fetch wardrobe insights for home screen
// NOTE: Must be before /:id route to avoid matching "insights" as an id
items.get("/insights", async (c) => {
  const userId = getUserId(c);

  // Get completed items with categories
  const { data: itemsData, error: itemsError } = await supabaseAdmin
    .from("wardrobe_items")
    .select("id, category, item_name, processed_image_url, times_worn")
    .eq("user_id", userId)
    .eq("is_archived", false)
    .eq("processing_status", "completed");

  if (itemsError) {
    return c.json({ error: "Failed to fetch wardrobe" }, 500);
  }

  const itemsList = itemsData || [];
  const itemCount = itemsList.length;
  const categories = [
    ...new Set(itemsList.map((i) => i.category).filter(Boolean)),
  ];
  const categoryCount = categories.length;

  // Find most worn item (using times_worn from items table)
  let mostWornItem = null;
  if (itemCount > 0) {
    const topItem = itemsList.reduce(
      (max, item) =>
        (item.times_worn || 0) > (max.times_worn || 0) ? item : max,
      itemsList[0]
    );

    if (topItem.times_worn > 0) {
      mostWornItem = {
        id: topItem.id,
        name: topItem.item_name || topItem.category || "Item",
        imageUrl: topItem.processed_image_url,
        wearCount: topItem.times_worn,
      };
    }
  }

  return c.json({
    itemCount,
    categoryCount,
    categories,
    mostWornItem,
  });
});

// GET /:id - Fetch single item
items.get("/:id", async (c) => {
  const userId = getUserId(c);
  const itemId = c.req.param("id");

  const { data, error } = await supabaseAdmin
    .from("wardrobe_items")
    .select("*")
    .eq("id", itemId)
    .eq("user_id", userId)
    .single();

  if (error) {
    return c.json({ error: "Item not found" }, 404);
  }

  return c.json({ item: mapItemToResponse(data) });
});

// PATCH /:id - Update item
items.patch("/:id", async (c) => {
  const userId = getUserId(c);
  const itemId = c.req.param("id");

  const body = await c.req.json();

  // Accept both "name" and "item_name" for flexibility
  const itemName = body.item_name ?? body.name ?? undefined;

  // Accept both camelCase and snake_case for wear stats
  const timesWorn = body.times_worn ?? body.timesWorn ?? undefined;
  const lastWornAt = body.last_worn_at ?? body.lastWorn ?? body.lastWornAt ?? undefined;

  // Build update object - only include fields that were provided
  const updates: Record<string, unknown> = {};
  if (itemName !== undefined) updates.item_name = itemName;
  if (body.category !== undefined) updates.category = body.category;
  if (body.is_favorite !== undefined) updates.is_favorite = body.is_favorite;
  if (body.is_archived !== undefined) updates.is_archived = body.is_archived;
  if (timesWorn !== undefined) updates.times_worn = timesWorn;
  if (lastWornAt !== undefined) updates.last_worn_at = lastWornAt;

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  const { data, error } = await supabaseAdmin
    .from("wardrobe_items")
    .update(updates)
    .eq("id", itemId)
    .eq("user_id", userId) // Security: ensure user owns item
    .select()
    .single();

  if (error || !data) {
    return c.json({ error: "Item not found or update failed" }, 404);
  }

  return c.json({ item: mapItemToResponse(data) });
});

// POST / - Upload single item
items.post("/", itemUploadLimit, async (c) => {
  const userId = getUserId(c);

  // Require AI consent before processing
  if (!(await hasAIConsent(userId))) {
    return c.json({ error: "AI data consent required before processing" }, 403);
  }

  // Check item limit for free users
  const limitCheck = await checkItemLimit(userId);
  if (!limitCheck.allowed) {
    return c.json(
      {
        error: "Item limit reached",
        used: limitCheck.used,
        limit: limitCheck.limit,
      },
      403
    );
  }

  const body = await c.req.json();
  const { image_url } = body;
  // Accept both "name" and "item_name" for flexibility
  const itemName = body.item_name ?? body.name ?? null;

  if (!image_url) {
    return c.json({ error: "image_url is required" }, 400);
  }

  // Create item with processing status
  const { data, error } = await supabaseAdmin
    .from("wardrobe_items")
    .insert({
      user_id: userId,
      original_image_url: image_url,
      item_name: itemName,
      processing_status: "processing",
      times_worn: 0,
      is_archived: false,
    })
    .select()
    .single();

  if (error) {
    return c.json({ error: "Failed to create item" }, 500);
  }

  // Trigger background processing (non-blocking)
  processItemInBackground(data.id, image_url, userId).catch((err) => {
    console.error(`[AI] Background processing failed for ${data.id}:`, err);
  });

  // Check if first item triggers referral completion (fire-and-forget)
  if (limitCheck.used === 0) {
    ReferralService.completeReferral(userId).catch((err) => {
      console.error("[Referral] Error completing referral:", err);
    });
  }

  // Award XP for adding item (fire-and-forget)
  const gamificationPromise = (async () => {
    try {
      const xpResult = await GamificationService.awardXP(
        userId,
        XP_AMOUNTS.ADD_ITEM,
        "add_item",
        data.id,
        "Added wardrobe item"
      );

      // Update challenge progress
      await GamificationService.updateChallengeProgress(userId, "add_item", 1);

      // Increment stats
      await GamificationService.incrementStat(userId, "total_items_added", 1);

      // Check for new achievements
      const newAchievements =
        await GamificationService.checkAndUnlockAchievements(userId);

      return { xpResult, newAchievements };
    } catch (err) {
      console.error("[Gamification] Error in add item:", err);
      return null;
    }
  })();

  // Wait briefly for gamification to complete (but don't block too long)
  const gamResult = await Promise.race([
    gamificationPromise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
  ]);

  return c.json(
    {
      item: mapItemToResponse(data),
      gamification: gamResult
        ? {
            xp_awarded: XP_AMOUNTS.ADD_ITEM,
            level_up: gamResult.xpResult?.level_up || false,
            new_level: gamResult.xpResult?.new_level,
            new_achievements: gamResult.newAchievements || [],
          }
        : undefined,
    },
    201
  );
});

// POST /batch - Upload multiple items (max 10)
items.post("/batch", itemUploadLimit, async (c) => {
  const userId = getUserId(c);

  // Require AI consent before processing
  if (!(await hasAIConsent(userId))) {
    return c.json({ error: "AI data consent required before processing" }, 403);
  }

  const body = await c.req.json();
  const { items: itemsToUpload } = body;

  if (!Array.isArray(itemsToUpload) || itemsToUpload.length === 0) {
    return c.json({ error: "items array is required" }, 400);
  }

  if (itemsToUpload.length > 10) {
    return c.json({ error: "Maximum 10 items per batch" }, 400);
  }

  // Check item limit
  const limitCheck = await checkItemLimit(userId);
  const remainingSlots = limitCheck.limit - limitCheck.used;

  if (limitCheck.limit !== Infinity && itemsToUpload.length > remainingSlots) {
    return c.json(
      {
        error: "Would exceed item limit",
        used: limitCheck.used,
        limit: limitCheck.limit,
        requested: itemsToUpload.length,
      },
      403
    );
  }

  // Create items with processing status
  const itemsData = itemsToUpload.map((item: { image_url: string }) => ({
    user_id: userId,
    original_image_url: item.image_url,
    processing_status: "processing",
    times_worn: 0,
    is_archived: false,
  }));

  const { data, error } = await supabaseAdmin
    .from("wardrobe_items")
    .insert(itemsData)
    .select("id, original_image_url");

  if (error) {
    return c.json({ error: "Failed to create items" }, 500);
  }

  // Trigger background processing for each item (non-blocking)
  for (const item of data) {
    processItemInBackground(item.id, item.original_image_url, userId).catch((err) => {
      console.error(`[AI] Background processing failed for ${item.id}:`, err);
    });
  }

  const results = data.map((item) => ({
    id: item.id,
    status: "processing",
  }));

  // Check if this is first item upload - triggers referral completion (fire-and-forget)
  if (limitCheck.used === 0) {
    ReferralService.completeReferral(userId).catch((err) => {
      console.error("[Referral] Error completing referral:", err);
    });
  }

  // Award XP for each item added (fire-and-forget)
  const itemCount = data.length;
  void (async () => {
    try {
      // Award XP for each item
      for (const item of data) {
        await GamificationService.awardXP(
          userId,
          XP_AMOUNTS.ADD_ITEM,
          "add_item",
          item.id,
          "Added wardrobe item (batch)"
        );
      }

      // Update challenge progress for all items at once
      await GamificationService.updateChallengeProgress(
        userId,
        "add_item",
        itemCount
      );

      // Increment stats
      await GamificationService.incrementStat(
        userId,
        "total_items_added",
        itemCount
      );

      // Check for achievements
      await GamificationService.checkAndUnlockAchievements(userId);
    } catch (err) {
      console.error("[Gamification] Error in batch add:", err);
    }
  })();

  return c.json(
    {
      items: results,
      gamification: {
        xp_awarded: XP_AMOUNTS.ADD_ITEM * itemCount,
        items_count: itemCount,
      },
    },
    202
  );
});

// DELETE /:id - Delete item and associated storage files
items.delete("/:id", async (c) => {
  const userId = getUserId(c);
  const itemId = c.req.param("id");

  // Get item to find image paths
  const { data: item, error: fetchError } = await supabaseAdmin
    .from("wardrobe_items")
    .select("original_image_url, processed_image_url")
    .eq("id", itemId)
    .eq("user_id", userId)
    .single();

  if (fetchError || !item) {
    return c.json({ error: "Item not found" }, 404);
  }

  // Delete images from storage (best effort - don't fail if storage delete fails)
  try {
    // Extract path from original_image_url (wardrobe bucket)
    if (item.original_image_url) {
      const originalPath = extractStoragePath(item.original_image_url, "wardrobe");
      if (originalPath) {
        await supabaseAdmin.storage.from("wardrobe").remove([originalPath]);
        console.log(`[Storage] Deleted original image: ${originalPath}`);
      }
    }

    // Extract path from processed_image_url (wardrobe-items bucket)
    if (item.processed_image_url) {
      const processedPath = extractStoragePath(item.processed_image_url, "wardrobe-items");
      if (processedPath) {
        await supabaseAdmin.storage.from("wardrobe-items").remove([processedPath]);
        console.log(`[Storage] Deleted processed image: ${processedPath}`);
      }
    }
  } catch (storageErr) {
    console.error(`[Storage] Failed to delete images for item ${itemId}:`, storageErr);
    // Continue with database deletion even if storage fails
  }

  // Delete from database
  const { error: deleteError } = await supabaseAdmin
    .from("wardrobe_items")
    .delete()
    .eq("id", itemId)
    .eq("user_id", userId);

  if (deleteError) {
    return c.json({ error: "Failed to delete item" }, 500);
  }

  return c.body(null, 204);
});

// POST /:id/archive - Archive item
items.post("/:id/archive", async (c) => {
  const userId = getUserId(c);
  const itemId = c.req.param("id");

  const { data, error } = await supabaseAdmin
    .from("wardrobe_items")
    .update({ is_archived: true })
    .eq("id", itemId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) {
    return c.json({ error: "Failed to archive item" }, 500);
  }

  return c.json({ item: mapItemToResponse(data) });
});

export default items;

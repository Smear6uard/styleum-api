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
  imageUrl: string
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

// POST / - Upload single item
items.post("/", itemUploadLimit, async (c) => {
  const userId = getUserId(c);

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
  const { image_url, item_name } = body;

  if (!image_url) {
    return c.json({ error: "image_url is required" }, 400);
  }

  // Create item with processing status
  const { data, error } = await supabaseAdmin
    .from("wardrobe_items")
    .insert({
      user_id: userId,
      original_image_url: image_url,
      item_name: item_name || null,
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
  processItemInBackground(data.id, image_url).catch((err) => {
    console.error(`[AI] Background processing failed for ${data.id}:`, err);
  });

  return c.json({ item: mapItemToResponse(data) }, 201);
});

// POST /batch - Upload multiple items (max 10)
items.post("/batch", itemUploadLimit, async (c) => {
  const userId = getUserId(c);

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
    processItemInBackground(item.id, item.original_image_url).catch((err) => {
      console.error(`[AI] Background processing failed for ${item.id}:`, err);
    });
  }

  const results = data.map((item) => ({
    id: item.id,
    status: "processing",
  }));

  return c.json({ items: results }, 202);
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

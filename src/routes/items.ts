import { Hono } from "hono";
import { supabaseAdmin } from "../services/supabase.js";
import { checkItemLimit, FREE_ITEM_LIMIT } from "../utils/limits.js";
import { getUserId } from "../middleware/auth.js";
import { itemUploadLimit } from "../middleware/rateLimit.js";
import { removeBackground, generateEmbedding } from "../services/ai/index.js";

type Variables = {
  userId: string;
  email: string;
};

const items = new Hono<{ Variables: Variables }>();

/**
 * Process an item in the background:
 * 1. Remove background
 * 2. Generate embedding
 * 3. Update item in database
 */
async function processItemInBackground(itemId: string, imageUrl: string): Promise<void> {
  try {
    console.log(`[AI] Processing item ${itemId}`);

    // Step 1: Remove background
    const processedImageUrl = await removeBackground(imageUrl, itemId);
    console.log(`[AI] Background removed for ${itemId}`);

    // Step 2: Generate embedding from processed image
    const embedding = await generateEmbedding(processedImageUrl);
    console.log(`[AI] Embedding generated for ${itemId}`);

    // Step 3: Update item with results
    const { error } = await supabaseAdmin
      .from("wardrobe_items")
      .update({
        processed_image_url: processedImageUrl,
        embedding,
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

  return c.json({ items: data });
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

  return c.json({ item: data });
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
  const { image_url } = body;

  if (!image_url) {
    return c.json({ error: "image_url is required" }, 400);
  }

  // Create item with processing status
  const { data, error } = await supabaseAdmin
    .from("wardrobe_items")
    .insert({
      user_id: userId,
      original_image_url: image_url,
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

  return c.json({ item: data }, 201);
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

// DELETE /:id - Delete item
items.delete("/:id", async (c) => {
  const userId = getUserId(c);
  const itemId = c.req.param("id");

  const { error } = await supabaseAdmin
    .from("wardrobe_items")
    .delete()
    .eq("id", itemId)
    .eq("user_id", userId);

  if (error) {
    return c.json({ error: "Failed to delete item" }, 500);
  }

  return c.json({ success: true });
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

  return c.json({ item: data });
});

export default items;

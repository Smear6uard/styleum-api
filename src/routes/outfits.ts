import { Hono } from "hono";
import { supabaseAdmin } from "../services/supabase.js";
import { checkCreditLimit } from "../utils/limits.js";
import { getUserId } from "../middleware/auth.js";
import { styleMeLimit } from "../middleware/rateLimit.js";

type Variables = {
  userId: string;
  email: string;
};

const outfits = new Hono<{ Variables: Variables }>();

// GET / - Get cached outfits (not expired)
outfits.get("/", async (c) => {
  const userId = getUserId(c);
  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("generated_outfits")
    .select("*")
    .eq("user_id", userId)
    .gt("expires_at", now)
    .order("created_at", { ascending: false });

  if (error) {
    return c.json({ error: "Failed to fetch outfits" }, 500);
  }

  return c.json({ outfits: data });
});

// POST /generate - Generate outfits (Style Me)
outfits.post("/generate", styleMeLimit, async (c) => {
  const userId = getUserId(c);

  // Check credit limit
  const limitCheck = await checkCreditLimit(userId);
  if (!limitCheck.allowed) {
    return c.json(
      {
        error: "Monthly style credit limit reached",
        used: limitCheck.used,
        limit: limitCheck.limit,
      },
      403
    );
  }

  const body = await c.req.json();
  const { occasion } = body;

  // Placeholder for Phase 4 - will implement actual outfit generation
  // For now, create a placeholder outfit
  const { data, error } = await supabaseAdmin
    .from("generated_outfits")
    .insert({
      user_id: userId,
      items: [],
      occasion: occasion ?? null,
      style_score: null,
      is_saved: false,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
    })
    .select()
    .single();

  if (error) {
    return c.json({ error: "Failed to generate outfit" }, 500);
  }

  return c.json({
    outfit: data,
    message: "Outfit generation placeholder - will be implemented in Phase 4",
  });
});

// POST /:id/wear - Mark outfit as worn
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

  // Calculate XP: 10 base, 20 if photo provided
  const xpAwarded = photo_url ? 20 : 10;

  // Add to outfit history
  const { error: historyError } = await supabaseAdmin
    .from("outfit_history")
    .insert({
      user_id: userId,
      outfit_id: outfitId,
      worn_at: new Date().toISOString(),
      photo_url: photo_url ?? null,
      xp_awarded: xpAwarded,
    });

  if (historyError) {
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

  return c.json({
    success: true,
    xp_awarded: xpAwarded,
  });
});

// POST /:id/save - Save outfit
outfits.post("/:id/save", async (c) => {
  const userId = getUserId(c);
  const outfitId = c.req.param("id");

  const { data, error } = await supabaseAdmin
    .from("generated_outfits")
    .update({ is_saved: true })
    .eq("id", outfitId)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) {
    return c.json({ error: "Failed to save outfit" }, 500);
  }

  return c.json({ outfit: data });
});

// GET /history - Get outfit history with pagination
outfits.get("/history", async (c) => {
  const userId = getUserId(c);
  const page = parseInt(c.req.query("page") ?? "1");
  const limit = parseInt(c.req.query("limit") ?? "20");
  const offset = (page - 1) * limit;

  const { data, error, count } = await supabaseAdmin
    .from("outfit_history")
    .select("*, generated_outfits(*)", { count: "exact" })
    .eq("user_id", userId)
    .order("worn_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return c.json({ error: "Failed to fetch history" }, 500);
  }

  return c.json({
    history: data,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / limit),
    },
  });
});

export default outfits;

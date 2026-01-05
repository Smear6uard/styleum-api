import { Hono } from "hono";
import { supabaseAdmin } from "../services/supabase.js";
import { getUserId } from "../middleware/auth.js";
import {
  initializeTasteVector,
  hasCompletedOnboarding,
} from "../services/tasteVector.js";

type Variables = {
  userId: string;
  email: string;
};

const onboarding = new Hono<{ Variables: Variables }>();

/**
 * GET /status - Check if user has completed onboarding
 */
onboarding.get("/status", async (c) => {
  const userId = getUserId(c);

  const completed = await hasCompletedOnboarding(userId);

  // Also check user_profiles.onboarding_completed
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("onboarding_completed")
    .eq("id", userId)
    .single();

  return c.json({
    completed: completed && profile?.onboarding_completed === true,
    has_taste_vector: completed,
    next_step: completed ? null : "style_swipes",
  });
});

/**
 * GET /style-images - Get style reference images for onboarding swipes
 */
onboarding.get("/style-images", async (c) => {
  const { data: images, error } = await supabaseAdmin
    .from("style_reference_images")
    .select("id, image_url, style_tags, vibe, gender, formality_score")
    .eq("active", true)
    .order("display_order", { ascending: true })
    .limit(30);

  if (error) {
    console.error("[Onboarding] Failed to fetch style images:", error);
    return c.json({ error: "Failed to fetch style images" }, 500);
  }

  return c.json({ images: images || [] });
});

/**
 * POST /complete - Submit onboarding swipe results and initialize taste vector
 */
onboarding.post("/complete", async (c) => {
  const userId = getUserId(c);

  const body = await c.req.json();
  const { liked_image_ids, disliked_image_ids } = body;

  if (!Array.isArray(liked_image_ids) || !Array.isArray(disliked_image_ids)) {
    return c.json(
      { error: "liked_image_ids and disliked_image_ids arrays required" },
      400
    );
  }

  // Minimum swipes required
  const totalSwipes = liked_image_ids.length + disliked_image_ids.length;
  if (totalSwipes < 10) {
    return c.json(
      {
        error: "Minimum 10 swipes required",
        current: totalSwipes,
        required: 10,
      },
      400
    );
  }

  try {
    // Initialize taste vector
    await initializeTasteVector(userId, liked_image_ids, disliked_image_ids);

    // Mark onboarding complete in user profile
    await supabaseAdmin
      .from("user_profiles")
      .update({ onboarding_completed: true })
      .eq("id", userId);

    return c.json({
      success: true,
      message: "Taste profile created",
      stats: {
        likes: liked_image_ids.length,
        dislikes: disliked_image_ids.length,
        total: totalSwipes,
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[Onboarding] Failed to complete onboarding:", errorMessage);
    return c.json({ error: "Failed to initialize taste profile" }, 500);
  }
});

/**
 * POST /skip - Skip onboarding (creates empty taste vector)
 */
onboarding.post("/skip", async (c) => {
  const userId = getUserId(c);

  // Create an empty/neutral taste vector
  const neutralVector = new Array(768).fill(0);
  // Set first element to 1 to avoid zero vector issues
  neutralVector[0] = 1;

  const now = new Date().toISOString();

  const { error } = await supabaseAdmin.from("user_taste_vectors").upsert({
    user_id: userId,
    taste_vector: neutralVector,
    initialized_at: now,
    last_updated: now,
    interaction_count: 0,
  });

  if (error) {
    console.error("[Onboarding] Failed to skip onboarding:", error);
    return c.json({ error: "Failed to skip onboarding" }, 500);
  }

  // Mark onboarding complete
  await supabaseAdmin
    .from("user_profiles")
    .update({ onboarding_completed: true })
    .eq("id", userId);

  return c.json({
    success: true,
    message: "Onboarding skipped - using neutral preferences",
  });
});

export default onboarding;

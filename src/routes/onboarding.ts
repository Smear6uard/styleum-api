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
    .select("onboarding_completed, onboarding_version, departments")
    .eq("id", userId)
    .single();

  return c.json({
    completed: completed && profile?.onboarding_completed === true,
    has_taste_vector: completed,
    onboarding_version: profile?.onboarding_version ?? null,
    departments: profile?.departments ?? [],
    next_step: completed ? null : "style_swipes",
  });
});

/**
 * GET /style-images - Get style reference images for onboarding swipes
 * Query params:
 *   - department: "womenswear" | "menswear" (optional, filters by gender)
 */
onboarding.get("/style-images", async (c) => {
  const department = c.req.query("department");

  // Build query
  let query = supabaseAdmin
    .from("style_reference_images")
    .select("id, image_url, style_tags, vibe, gender, formality_score")
    .eq("active", true);

  // Filter by department -> gender mapping
  if (department === "womenswear") {
    // Show female and unisex images for womenswear
    query = query.in("gender", ["female", "unisex"]);
  } else if (department === "menswear") {
    // Show male and unisex images for menswear
    query = query.in("gender", ["male", "unisex"]);
  }
  // If no department specified, show all images

  // Randomize order and limit to 20
  const { data: images, error } = await query.limit(50);

  if (error) {
    console.error("[Onboarding] Failed to fetch style images:", error);
    return c.json({ error: "Failed to fetch style images" }, 500);
  }

  // Shuffle and take 20
  const shuffled = (images || []).sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, 20);

  return c.json({ images: selected });
});

/**
 * POST /complete - Submit onboarding swipe results and initialize taste vector
 * Body:
 *   - first_name: string
 *   - departments: string[] (e.g., ["womenswear"] or ["menswear"])
 *   - body_shape: string | null
 *   - favorite_brands: string[]
 *   - liked_style_ids: string[] (UUIDs of liked style reference images)
 *   - disliked_style_ids: string[] (UUIDs of disliked style reference images)
 *   - referral_source: string | null (how user heard about us: tiktok, instagram, friend, app_store, other)
 */
onboarding.post("/complete", async (c) => {
  const userId = getUserId(c);

  const body = await c.req.json();
  const {
    first_name,
    departments,
    body_shape,
    favorite_brands,
    liked_style_ids,
    disliked_style_ids,
    referral_source,
    // Support legacy field names too
    liked_image_ids,
    disliked_image_ids,
  } = body;

  // Use new field names or fall back to legacy
  const likedIds = liked_style_ids || liked_image_ids || [];
  const dislikedIds = disliked_style_ids || disliked_image_ids || [];

  if (!Array.isArray(likedIds) || !Array.isArray(dislikedIds)) {
    return c.json(
      { error: "liked_style_ids and disliked_style_ids arrays required" },
      400
    );
  }

  // Minimum swipes required
  const totalSwipes = likedIds.length + dislikedIds.length;
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
    // Initialize taste vector from swipe data
    await initializeTasteVector(userId, likedIds, dislikedIds);

    // Update user profile with onboarding data
    const profileUpdate: Record<string, unknown> = {
      onboarding_completed: true,
      onboarding_version: 2, // v2 = new onboarding flow with departments
    };

    if (first_name) {
      profileUpdate.first_name = first_name;
    }
    if (Array.isArray(departments)) {
      profileUpdate.departments = departments;
    }
    if (body_shape !== undefined) {
      profileUpdate.body_shape = body_shape;
    }
    if (Array.isArray(favorite_brands)) {
      profileUpdate.favorite_brands = favorite_brands;
    }
    if (referral_source) {
      profileUpdate.referral_source = referral_source;
    }

    await supabaseAdmin
      .from("user_profiles")
      .update(profileUpdate)
      .eq("id", userId);

    return c.json({
      success: true,
      message: "Taste profile created",
      stats: {
        likes: likedIds.length,
        dislikes: dislikedIds.length,
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
    .update({
      onboarding_completed: true,
      onboarding_version: 2,
    })
    .eq("id", userId);

  return c.json({
    success: true,
    message: "Onboarding skipped - using neutral preferences",
  });
});

export default onboarding;

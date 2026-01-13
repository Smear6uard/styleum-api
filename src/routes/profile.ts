import { Hono, type Context } from "hono";
import { supabaseAdmin } from "../services/supabase.js";
import { getUserId } from "../middleware/auth.js";

type Variables = {
  userId: string;
  email: string;
};

const profile = new Hono<{ Variables: Variables }>();

/**
 * GET / - Fetch user profile
 * Returns the full user profile from user_profiles table
 */
profile.get("/", async (c) => {
  const userId = getUserId(c);

  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("[Profile] Failed to fetch profile:", error);
    return c.json({ error: "Failed to fetch profile" }, 500);
  }

  if (!data) {
    return c.json({ error: "Profile not found" }, 404);
  }

  return c.json(data);
});

/**
 * Helper function to handle profile updates
 * Supports both snake_case (location_lat) and iOS naming (latitude)
 */
async function handleProfileUpdate(c: Context<{ Variables: Variables }>) {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => ({}));

  const {
    // Support both naming conventions
    location_lat,
    location_lng,
    latitude,
    longitude,
    push_token,
    push_enabled,
    morning_notification_time,
    timezone,
    // Height and skin undertone - support both snake_case and camelCase
    height_category,
    heightCategory,
    skin_undertone,
    skinUndertone,
  } = body;

  // Build updates object with only provided fields
  const updates: Record<string, unknown> = {};

  // Handle location - support both naming conventions
  const lat = location_lat ?? latitude;
  const lng = location_lng ?? longitude;
  if (lat !== undefined) updates.location_lat = lat;
  if (lng !== undefined) updates.location_lng = lng;

  if (push_token !== undefined) updates.push_token = push_token;
  if (push_enabled !== undefined) updates.push_enabled = push_enabled;
  if (morning_notification_time !== undefined)
    updates.morning_notification_time = morning_notification_time;
  if (timezone !== undefined) updates.timezone = timezone;

  // Height and skin undertone - validate and save
  const validHeights = ["short", "average", "tall"];
  const validUndertones = ["warm", "cool", "neutral"];
  const effectiveHeight = height_category ?? heightCategory;
  const effectiveUndertone = skin_undertone ?? skinUndertone;

  if (effectiveHeight !== undefined) {
    if (effectiveHeight === null || validHeights.includes(effectiveHeight)) {
      updates.height_category = effectiveHeight;
    }
  }
  if (effectiveUndertone !== undefined) {
    if (effectiveUndertone === null || validUndertones.includes(effectiveUndertone)) {
      updates.skin_undertone = effectiveUndertone;
    }
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  const { error } = await supabaseAdmin.from("user_profiles").update(updates).eq("id", userId);

  if (error) {
    console.error("[Profile] Failed to update profile:", error);
    return c.json({ error: "Failed to update profile" }, 500);
  }

  console.log(`[Profile] Updated for user ${userId}:`, Object.keys(updates).join(", "));

  return c.json({ success: true, updated: Object.keys(updates) });
}

/**
 * PATCH / - Update user profile
 * Supports updating location, timezone, and push notification settings
 */
profile.patch("/", handleProfileUpdate);

/**
 * PUT / - Update user profile (alias for PATCH for iOS compatibility)
 * iOS uses PUT for profile updates
 */
profile.put("/", handleProfileUpdate);

/**
 * POST /push-token - Register device push token
 * Stores the APNs device token for push notifications
 */
profile.post("/push-token", async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => ({}));

  const { token, platform } = body;

  if (!token || typeof token !== "string") {
    return c.json({ error: "Token is required" }, 400);
  }

  // Validate platform (for future Android support)
  if (platform && platform !== "ios") {
    return c.json({ error: "Invalid platform. Supported: ios" }, 400);
  }

  const { error } = await supabaseAdmin
    .from("user_profiles")
    .update({
      push_token: token,
      push_token_updated_at: new Date().toISOString(),
      push_enabled: true,
    })
    .eq("id", userId);

  if (error) {
    console.error("[Profile] Failed to save push token:", error);
    return c.json({ error: "Failed to save push token" }, 500);
  }

  console.log(`[Profile] Push token registered for user ${userId}`);

  return c.json({ success: true });
});

/**
 * POST /tier-onboarding-seen - Mark tier onboarding as seen
 * Called when user has viewed the tier/subscription onboarding screens
 */
profile.post("/tier-onboarding-seen", async (c) => {
  const userId = getUserId(c);

  const now = new Date().toISOString();

  const { error } = await supabaseAdmin
    .from("user_profiles")
    .update({
      tier_onboarding_seen_at: now,
    })
    .eq("id", userId);

  if (error) {
    console.error("[Profile] Failed to mark tier onboarding as seen:", error);
    return c.json({ error: "Failed to update profile" }, 500);
  }

  console.log(`[Profile] Tier onboarding marked as seen for user ${userId}`);

  return c.json({
    success: true,
    tier_onboarding_seen_at: now,
  });
});

export default profile;

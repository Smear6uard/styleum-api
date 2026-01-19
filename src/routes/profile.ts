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
    .select(`
      *,
      schools (
        slug,
        name
      )
    `)
    .eq("id", userId)
    .single();

  if (error) {
    console.error("[Profile] Failed to fetch profile:", error);
    return c.json({ error: "Failed to fetch profile" }, 500);
  }

  if (!data) {
    return c.json({ error: "Profile not found" }, 404);
  }

  // Extract school info and flatten response
  const { schools, ...profile } = data;
  return c.json({
    ...profile,
    school_slug: schools?.slug ?? null,
    school_name: schools?.name ?? null,
  });
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
    // Evening confirmation preferences
    evening_confirmation_enabled,
    eveningConfirmationEnabled,
    evening_confirmation_time,
    eveningConfirmationTime,
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

  // Evening confirmation preferences - support both naming conventions
  const effectiveEveningEnabled = evening_confirmation_enabled ?? eveningConfirmationEnabled;
  const effectiveEveningTime = evening_confirmation_time ?? eveningConfirmationTime;

  if (effectiveEveningEnabled !== undefined) {
    updates.evening_confirmation_enabled = effectiveEveningEnabled;
  }
  if (effectiveEveningTime !== undefined) {
    // Validate time format (HH:MM or HH:MM:SS)
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
    if (effectiveEveningTime === null || timeRegex.test(effectiveEveningTime)) {
      // Normalize to HH:MM:SS format
      let normalizedTime = effectiveEveningTime;
      if (normalizedTime && !normalizedTime.includes(":")) {
        normalizedTime = null;
      } else if (normalizedTime && normalizedTime.split(":").length === 2) {
        normalizedTime = `${normalizedTime}:00`;
      }
      updates.evening_confirmation_time = normalizedTime;
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

/**
 * GET /school - Get user's current school info
 * Returns school details and tier status
 */
profile.get("/school", async (c) => {
  const userId = getUserId(c);

  const { data: profile, error } = await supabaseAdmin
    .from("user_profiles")
    .select(`
      school_id,
      tier,
      tier_updated_at,
      schools (
        id,
        name,
        short_name,
        slug,
        location
      )
    `)
    .eq("id", userId)
    .single();

  if (error) {
    console.error("[Profile] Failed to fetch school info:", error);
    return c.json({ error: "Failed to fetch school info" }, 500);
  }

  if (!profile.school_id) {
    return c.json({ school: null, tier: null, tier_updated_at: null });
  }

  return c.json({
    school: profile.schools,
    tier: profile.tier,
    tier_updated_at: profile.tier_updated_at,
  });
});

/**
 * PATCH /school - Update user's school
 * Allows user to join a school by slug for campus competition
 */
profile.patch("/school", async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => ({}));

  const { school_slug, schoolSlug } = body;
  const slug = school_slug || schoolSlug;

  if (!slug) {
    return c.json({ error: "school_slug is required" }, 400);
  }

  try {
    // Look up school by slug
    const { data: school, error: schoolError } = await supabaseAdmin
      .from("schools")
      .select("id, name, short_name, slug, is_active")
      .eq("slug", slug)
      .single();

    if (schoolError || !school) {
      return c.json({ error: "School not found" }, 404);
    }

    if (!school.is_active) {
      return c.json({ error: "This school is not yet active" }, 403);
    }

    // Update user's school_id and set tier to rookie
    const { error: updateError } = await supabaseAdmin
      .from("user_profiles")
      .update({
        school_id: school.id,
        tier: "rookie",
        tier_updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateError) {
      console.error("[Profile] Failed to update school:", updateError);
      return c.json({ error: "Failed to update school" }, 500);
    }

    console.log(`[Profile] User ${userId} joined school ${school.name}`);

    return c.json({
      success: true,
      school: {
        id: school.id,
        name: school.name,
        short_name: school.short_name,
        slug: school.slug,
      },
    });
  } catch (error) {
    console.error("[Profile] Error updating school:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * DELETE /school - Leave current school
 * Removes user from their current school
 */
profile.delete("/school", async (c) => {
  const userId = getUserId(c);

  try {
    const { error: updateError } = await supabaseAdmin
      .from("user_profiles")
      .update({
        school_id: null,
        tier: null,
        tier_updated_at: null,
      })
      .eq("id", userId);

    if (updateError) {
      console.error("[Profile] Failed to leave school:", updateError);
      return c.json({ error: "Failed to leave school" }, 500);
    }

    console.log(`[Profile] User ${userId} left their school`);

    return c.json({
      success: true,
      message: "Left school successfully",
    });
  } catch (error) {
    console.error("[Profile] Error leaving school:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default profile;

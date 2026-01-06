import { Hono } from "hono";
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
 * PATCH / - Update user profile
 * Supports updating location and push notification settings
 */
profile.patch("/", async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => ({}));

  const { location_lat, location_lng, push_token, push_enabled, morning_notification_time } = body;

  // Build updates object with only provided fields
  const updates: Record<string, unknown> = {};

  if (location_lat !== undefined) updates.location_lat = location_lat;
  if (location_lng !== undefined) updates.location_lng = location_lng;
  if (push_token !== undefined) updates.push_token = push_token;
  if (push_enabled !== undefined) updates.push_enabled = push_enabled;
  if (morning_notification_time !== undefined)
    updates.morning_notification_time = morning_notification_time;

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
});

export default profile;

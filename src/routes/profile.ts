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

  return c.json({ profile: data });
});

export default profile;

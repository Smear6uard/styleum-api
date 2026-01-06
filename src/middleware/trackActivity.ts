/**
 * Activity Tracking Middleware
 * Updates last_active_at for active users (fire-and-forget, non-blocking)
 * Used to determine which users should receive pre-generated outfits
 */

import type { Context, Next } from "hono";
import { supabaseAdmin } from "../services/supabase.js";

type Variables = {
  userId: string;
  email: string;
};

export async function trackUserActivity(
  c: Context<{ Variables: Variables }>,
  next: Next
) {
  // Continue with request first (non-blocking)
  await next();

  // Update last_active_at in background (don't await)
  const userId = c.get("userId");

  if (userId) {
    // Fire-and-forget update (don't block the response)
    void (async () => {
      try {
        await supabaseAdmin
          .from("user_profiles")
          .update({ last_active_at: new Date().toISOString() })
          .eq("id", userId);
      } catch (error) {
        console.warn("[Activity] Failed to update last_active_at:", error);
      }
    })();
  }
}

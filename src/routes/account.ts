import { Hono } from "hono";
import { supabaseAdmin } from "../services/supabase.js";
import { getUserId } from "../middleware/auth.js";

type Variables = {
  userId: string;
  email: string;
};

const account = new Hono<{ Variables: Variables }>();

/**
 * DELETE /api/account
 * Permanently deletes user account and all associated data
 * Required by Apple App Store guidelines
 */
account.delete("/", async (c) => {
  const userId = getUserId(c);
  console.log(`[Account] Starting account deletion for user: ${userId}`);

  // 1. Delete from all tables (explicit for logging, CASCADE would handle it)
  const tables = [
    "saved_outfits",
    "user_achievements",
    "outfit_history",
    "generated_outfits",
    "user_taste_vectors",
    "wardrobe_items",
    "user_gamification",
    "user_subscriptions",
    "user_profiles",
  ];

  for (const table of tables) {
    const col = table === "user_profiles" ? "id" : "user_id";
    const { error } = await supabaseAdmin.from(table).delete().eq(col, userId);
    if (error) {
      console.log(`[Account] ${table}: ${error.message}`);
    } else {
      console.log(`[Account] Deleted from ${table}`);
    }
  }

  // 2. Delete storage files from both buckets
  for (const bucket of ["wardrobe-items", "outfit-verifications"]) {
    try {
      const { data: files } = await supabaseAdmin.storage
        .from(bucket)
        .list(userId);

      if (files && files.length > 0) {
        const paths = files.map((f) => `${userId}/${f.name}`);
        const { error: storageError } = await supabaseAdmin.storage
          .from(bucket)
          .remove(paths);

        if (storageError) {
          console.log(`[Account] ${bucket} storage error: ${storageError.message}`);
        } else {
          console.log(`[Account] Deleted ${paths.length} files from ${bucket}`);
        }
      }
    } catch (err) {
      console.log(`[Account] ${bucket} cleanup error (non-fatal):`, err);
    }
  }

  // 3. Delete the auth user (this is permanent!)
  const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId);

  if (authError) {
    console.error(`[Account] Auth deletion failed: ${authError.message}`);
    return c.json({
      success: true,
      warning: "Account data deleted, but auth cleanup requires admin intervention",
      userId,
    });
  }

  console.log(`[Account] Successfully deleted account: ${userId}`);

  return c.json({
    success: true,
    message: "Account permanently deleted",
    userId,
  });
});

/**
 * GET /api/account/data
 * Returns all data associated with user (for GDPR data export)
 */
account.get("/data", async (c) => {
  const userId = getUserId(c);

  const [
    profile,
    items,
    outfits,
    saved,
    history,
    achievements,
    gamification,
    subscription,
    tasteVector,
  ] = await Promise.all([
    supabaseAdmin.from("user_profiles").select("*").eq("id", userId).single(),
    supabaseAdmin.from("wardrobe_items").select("*").eq("user_id", userId),
    supabaseAdmin.from("generated_outfits").select("*").eq("user_id", userId),
    supabaseAdmin.from("saved_outfits").select("*").eq("user_id", userId),
    supabaseAdmin.from("outfit_history").select("*").eq("user_id", userId),
    supabaseAdmin.from("user_achievements").select("*").eq("user_id", userId),
    supabaseAdmin.from("user_gamification").select("*").eq("user_id", userId).single(),
    supabaseAdmin.from("user_subscriptions").select("*").eq("user_id", userId).single(),
    supabaseAdmin.from("user_taste_vectors").select("*").eq("user_id", userId).single(),
  ]);

  return c.json({
    exportDate: new Date().toISOString(),
    userId,
    profile: profile.data,
    wardrobeItems: items.data,
    generatedOutfits: outfits.data,
    savedOutfits: saved.data,
    outfitHistory: history.data,
    achievements: achievements.data,
    gamification: gamification.data,
    subscription: subscription.data,
    tasteVector: tasteVector.data,
  });
});

export default account;

/**
 * First Outfit Auto-Generation Service
 * Automatically generates a user's first outfit when their wardrobe
 * has enough items (top + bottom + shoes)
 */

import { supabaseAdmin } from "./supabase.js";
import { generateOutfits, saveGeneratedOutfit } from "./outfitGenerator.js";

// Categories that count as each slot
const TOP_CATEGORIES = [
  "top", "tops", "t-shirt", "t-shirts", "shirt", "shirts",
  "blouse", "blouses", "sweater", "sweaters", "hoodie", "hoodies",
  "cardigan", "cardigans", "polo", "polos", "tank", "tank top"
];

const BOTTOM_CATEGORIES = [
  "bottom", "bottoms", "pants", "jeans", "shorts",
  "skirt", "skirts", "trousers", "chinos", "joggers", "leggings"
];

const SHOE_CATEGORIES = [
  "shoes", "footwear", "sneakers", "boots", "sandals",
  "loafers", "heels", "flats", "oxfords", "dress shoes"
];

/**
 * Check if user has required wardrobe items and generate their first outfit
 * Called after each item finishes processing
 *
 * @returns true if first outfit was generated, false otherwise
 */
export async function checkAndGenerateFirstOutfit(userId: string): Promise<boolean> {
  try {
    console.log(`[FirstOutfit] Checking eligibility for user ${userId}`);

    // 1. Check if user already has ANY outfits (quick exit if so)
    const { count: outfitCount, error: countError } = await supabaseAdmin
      .from("generated_outfits")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId);

    if (countError) {
      console.error("[FirstOutfit] Error checking outfit count:", countError);
      return false;
    }

    if (outfitCount && outfitCount > 0) {
      console.log(`[FirstOutfit] User ${userId} already has ${outfitCount} outfits, skipping`);
      return false;
    }

    // 2. Check wardrobe composition (completed items only)
    const { data: items, error: itemsError } = await supabaseAdmin
      .from("wardrobe_items")
      .select("category")
      .eq("user_id", userId)
      .eq("processing_status", "completed")
      .eq("is_archived", false);

    if (itemsError) {
      console.error("[FirstOutfit] Error fetching items:", itemsError);
      return false;
    }

    if (!items || items.length === 0) {
      console.log(`[FirstOutfit] User ${userId} has no completed items`);
      return false;
    }

    const categories = items.map((i) => (i.category || "").toLowerCase());

    const hasTop = categories.some((c) => TOP_CATEGORIES.includes(c));
    const hasBottom = categories.some((c) => BOTTOM_CATEGORIES.includes(c));
    const hasShoes = categories.some((c) => SHOE_CATEGORIES.includes(c));

    console.log(
      `[FirstOutfit] User ${userId} wardrobe: top=${hasTop}, bottom=${hasBottom}, shoes=${hasShoes}`
    );

    if (!hasTop || !hasBottom || !hasShoes) {
      // Log what's missing for debugging
      const missing: string[] = [];
      if (!hasTop) missing.push("top");
      if (!hasBottom) missing.push("bottom");
      if (!hasShoes) missing.push("shoes");
      console.log(`[FirstOutfit] User ${userId} missing: ${missing.join(", ")}`);
      return false;
    }

    console.log(`[FirstOutfit] 🎉 User ${userId} ready for first outfit! Generating...`);

    // 3. Fetch user location for weather-based generation
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("location_lat, location_lng")
      .eq("id", userId)
      .single();

    // 4. Generate exactly 1 outfit (user has minimal items)
    const { outfits, weather } = await generateOutfits({
      userId,
      lat: profile?.location_lat ?? undefined,
      lon: profile?.location_lng ?? undefined,
      count: 1, // Only 1 outfit - user has minimum items
    });

    if (!outfits || outfits.length === 0) {
      console.log(`[FirstOutfit] Generation returned no outfits for user ${userId}`);
      return false;
    }

    // 5. Save with special source - NO credit deduction (free hook!)
    const outfitId = await saveGeneratedOutfit(
      userId,
      outfits[0],
      undefined, // no occasion
      weather,
      "first_outfit_auto" // CRITICAL: iOS looks for this exact string
    );

    if (!outfitId) {
      console.error(`[FirstOutfit] Failed to save outfit for user ${userId}`);
      return false;
    }

    console.log(`[FirstOutfit] ✅ First outfit saved for user ${userId} (ID: ${outfitId})`);

    // 6. Send push notification (fire-and-forget)
    sendFirstOutfitNotification(userId).catch((err) => {
      console.error("[FirstOutfit] Push notification failed:", err);
    });

    return true;
  } catch (error) {
    console.error(`[FirstOutfit] Error for user ${userId}:`, error);
    return false;
  }
}

/**
 * Send push notification for first outfit
 */
async function sendFirstOutfitNotification(userId: string): Promise<void> {
  try {
    // Get user's push token
    const { data: profile } = await supabaseAdmin
      .from("user_profiles")
      .select("push_token, push_enabled")
      .eq("id", userId)
      .single();

    if (!profile?.push_token || !profile?.push_enabled) {
      console.log(`[FirstOutfit] No push token or push disabled for user ${userId}`);
      return;
    }

    // Import APNs service dynamically to avoid circular deps
    const { sendPushNotification } = await import("./apns.js");

    await sendPushNotification(profile.push_token, {
      title: "Your First Outfit is Ready! 🎉",
      body: "We styled your first look. Tap to see what to wear!",
      data: {
        type: "first_outfit",
        action: "navigate_outfits",
      },
    });

    console.log(`[FirstOutfit] Push notification sent to user ${userId}`);
  } catch (error) {
    // Don't throw - push is non-critical
    console.error(`[FirstOutfit] Push notification error:`, error);
  }
}

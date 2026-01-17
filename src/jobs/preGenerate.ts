/**
 * Pre-Generation Cron Job
 * Generates outfits in advance for active users to improve UX
 * Runs daily at 11 PM UTC (5 PM Chicago) via node-cron
 * Generates outfits for the NEXT day (target_date = tomorrow)
 */

import { supabaseAdmin } from "../services/supabase.js";
import { generateOutfits, saveGeneratedOutfit } from "../services/outfitGenerator.js";

interface PreGenerateResult {
  success: boolean;
  usersProcessed: number;
  outfitsGenerated: number;
  errors: number;
  skipped: number;
  errorDetails: string[];
  failedUserIds: string[];
  duration_ms: number;
}

interface ActiveUser {
  id: string;
  location_lat: number | null;
  location_lng: number | null;
  location_city: string | null;
  timezone: string | null;
}

const BATCH_SIZE = 10;
const OUTFITS_PER_USER = 4;
const ACTIVE_DAYS_THRESHOLD = 7;

export async function preGenerateOutfits(): Promise<PreGenerateResult> {
  const startTime = Date.now();

  console.log("[PreGen] ====================================");
  console.log("[PreGen] Starting 11PM UTC outfit pre-generation");
  console.log("[PreGen] ====================================");

  const result: PreGenerateResult = {
    success: true,
    usersProcessed: 0,
    outfitsGenerated: 0,
    errors: 0,
    skipped: 0,
    errorDetails: [],
    failedUserIds: [],
    duration_ms: 0,
  };

  try {
    // Step 1: Get active users (logged in within last 7 days)
    const activeUsers = await getActiveUsers();

    if (!activeUsers || activeUsers.length === 0) {
      console.log("[PreGen] No active users to process");
      result.duration_ms = Date.now() - startTime;
      return result;
    }

    console.log(`[PreGen] Found ${activeUsers.length} active users`);

    // Step 2: Filter users who have enough wardrobe items
    const eligibleUsers = await filterEligibleUsers(activeUsers);
    console.log(`[PreGen] ${eligibleUsers.length} users eligible (have enough items)`);
    result.skipped = activeUsers.length - eligibleUsers.length;

    // Step 3: Process users in batches
    const batches = createBatches(eligibleUsers, BATCH_SIZE);
    console.log(`[PreGen] Processing ${batches.length} batches of up to ${BATCH_SIZE} users`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(
        `[PreGen] Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} users)`
      );

      const batchResults = await Promise.allSettled(batch.map((user) => processUser(user)));

      // Tally results
      for (let i = 0; i < batchResults.length; i++) {
        const settledResult = batchResults[i];
        if (settledResult.status === "fulfilled") {
          if (settledResult.value.success) {
            result.usersProcessed++;
            result.outfitsGenerated += settledResult.value.outfitCount;
          } else {
            result.errors++;
            result.failedUserIds.push(settledResult.value.userId);
            result.errorDetails.push(settledResult.value.error || "Unknown error");
          }
        } else {
          result.errors++;
          // Get userId from the batch for rejected promises
          const failedUser = batch[i];
          if (failedUser) {
            result.failedUserIds.push(failedUser.id);
          }
          result.errorDetails.push(settledResult.reason?.message || "Promise rejected");
        }
      }

      // Small delay between batches to avoid overwhelming services
      if (batchIndex < batches.length - 1) {
        await sleep(2000);
      }
    }

    console.log("[PreGen] ====================================");
    console.log(`[PreGen] COMPLETE!`);
    console.log(`[PreGen] Users processed: ${result.usersProcessed}`);
    console.log(`[PreGen] Outfits generated: ${result.outfitsGenerated}`);
    console.log(`[PreGen] Errors: ${result.errors}`);
    console.log(`[PreGen] Skipped: ${result.skipped}`);
    if (result.failedUserIds.length > 0) {
      console.log(`[PreGen] Failed user IDs: ${result.failedUserIds.join(", ")}`);
    }
    console.log("[PreGen] ====================================");
  } catch (error) {
    result.success = false;
    const errorMsg = error instanceof Error ? error.message : "Unknown fatal error";
    result.errorDetails.push(`Fatal: ${errorMsg}`);
    console.error("[PreGen] FATAL ERROR:", error);
  }

  result.duration_ms = Date.now() - startTime;
  return result;
}

async function getActiveUsers(): Promise<ActiveUser[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ACTIVE_DAYS_THRESHOLD);

  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .select("id, location_lat, location_lng, location_city, timezone")
    .gte("last_active_at", cutoffDate.toISOString());

  if (error) {
    console.error("[PreGen] Failed to fetch active users:", error);
    throw error;
  }

  return data || [];
}

async function filterEligibleUsers(users: ActiveUser[]): Promise<ActiveUser[]> {
  const eligibleUsers: ActiveUser[] = [];

  for (const user of users) {
    const { data: itemCounts } = await supabaseAdmin
      .from("wardrobe_items")
      .select("category")
      .eq("user_id", user.id)
      .eq("is_archived", false)
      .eq("processing_status", "completed");

    if (!itemCounts) continue;

    // Count items by category type
    const categories = itemCounts.map((item) => (item.category || "").toLowerCase());
    const hasTop = categories.some((c) =>
      ["top", "tops", "t-shirt", "shirt", "blouse", "sweater", "hoodie"].includes(c)
    );
    const hasBottom = categories.some((c) =>
      ["bottom", "bottoms", "pants", "jeans", "shorts", "skirt", "trousers"].includes(c)
    );
    const hasShoes = categories.some((c) =>
      ["shoes", "footwear", "sneakers", "boots", "sandals", "loafers"].includes(c)
    );

    if (hasTop && hasBottom && hasShoes) {
      eligibleUsers.push(user);
    } else {
      console.log(
        `[PreGen] Skipping user ${user.id} - insufficient items (top:${hasTop}, bottom:${hasBottom}, shoes:${hasShoes})`
      );
    }
  }

  return eligibleUsers;
}

interface ProcessUserResult {
  success: boolean;
  userId: string;
  outfitCount: number;
  error?: string;
}

async function processUser(user: ActiveUser): Promise<ProcessUserResult> {
  const userId = user.id;

  try {
    console.log(`[PreGen] Processing user ${userId}...`);

    // Calculate target_date as the NEXT day (what these outfits are FOR)
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const targetDate = tomorrow.toISOString().split("T")[0]; // "YYYY-MM-DD"
    console.log(`[PreGen] Target date: ${targetDate}`);

    // Step 1: Clear OLD pre-generated outfits (from past target_dates)
    await clearOldPreGeneratedOutfits(userId);

    // Step 2: Clear tomorrow's pre-generated (in case of re-run)
    await clearTomorrowsPreGeneratedOutfits(userId, targetDate);

    // Step 3: Generate new outfits
    const { outfits, weather } = await generateOutfits({
      userId,
      lat: user.location_lat ?? undefined,
      lon: user.location_lng ?? undefined,
      count: OUTFITS_PER_USER,
    });

    if (!outfits || outfits.length === 0) {
      console.log(`[PreGen] No outfits generated for user ${userId}`);
      return { success: false, userId, outfitCount: 0, error: "No outfits generated" };
    }

    // Step 4: Save outfits with target_date and collect IDs
    const outfitIds: string[] = [];
    for (const outfit of outfits) {
      const outfitId = await saveGeneratedOutfit(userId, outfit, undefined, weather, undefined, targetDate);
      if (outfitId) {
        outfitIds.push(outfitId);
      }
    }

    // Step 4: Mark outfits as pre-generated
    if (outfitIds.length > 0) {
      await markOutfitsAsPreGenerated(outfitIds);
    }

    console.log(`[PreGen] User ${userId}: ${outfitIds.length} outfits generated`);

    return { success: true, userId, outfitCount: outfitIds.length };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    console.error(`[PreGen] User ${userId} failed:`, errorMsg);
    return { success: false, userId, outfitCount: 0, error: `User ${userId}: ${errorMsg}` };
  }
}

async function clearOldPreGeneratedOutfits(userId: string): Promise<void> {
  // Get today's date in YYYY-MM-DD format
  const today = new Date().toISOString().split("T")[0];

  // Delete any pre-generated outfits with target_date before today
  const { error, count } = await supabaseAdmin
    .from("generated_outfits")
    .delete()
    .eq("user_id", userId)
    .eq("is_pre_generated", true)
    .lt("target_date", today);

  if (error) {
    console.warn(`[PreGen] Failed to clear old outfits for ${userId}:`, error);
  } else if (count && count > 0) {
    console.log(`[PreGen] Cleared ${count} old pre-generated outfits for ${userId}`);
  }
}

async function clearTomorrowsPreGeneratedOutfits(userId: string, targetDate: string): Promise<void> {
  // Delete any pre-generated outfits for the target_date (in case of re-run)
  const { error } = await supabaseAdmin
    .from("generated_outfits")
    .delete()
    .eq("user_id", userId)
    .eq("is_pre_generated", true)
    .eq("target_date", targetDate);

  if (error) {
    console.warn(`[PreGen] Failed to clear tomorrow's outfits for ${userId}:`, error);
    // Non-fatal, continue anyway
  }
}

async function markOutfitsAsPreGenerated(outfitIds: string[]): Promise<void> {
  const { error } = await supabaseAdmin
    .from("generated_outfits")
    .update({
      is_pre_generated: true,
      source: "pre_generated_4am",
    })
    .in("id", outfitIds);

  if (error) {
    console.warn("[PreGen] Failed to mark outfits as pre-generated:", error);
  }
}

function createBatches<T>(items: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

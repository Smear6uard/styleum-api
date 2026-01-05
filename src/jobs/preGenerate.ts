/**
 * Pre-Generation Cron Job
 * Generates outfits in advance for active users to improve UX
 * Runs daily at 4 AM via external cron trigger (e.g., Railway cron, Vercel cron)
 */

import { supabaseAdmin } from "../services/supabase.js";
import { generateOutfits, saveGeneratedOutfit } from "../services/outfitGenerator.js";

const BATCH_SIZE = 10;
const OUTFITS_PER_USER = 4;
const ACTIVE_DAYS_THRESHOLD = 7; // Users active in last 7 days

interface ActiveUser {
  id: string;
  last_sign_in_at: string | null;
}

/**
 * Get users who are active and eligible for pre-generation
 * - Logged in within last 7 days
 * - Has completed onboarding (has wardrobe items)
 * - Does not already have 4+ unexpired outfits
 */
async function getEligibleUsers(): Promise<string[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - ACTIVE_DAYS_THRESHOLD);

  // Get recently active users from auth
  const { data: authUsers, error: authError } = await supabaseAdmin.auth.admin.listUsers({
    perPage: 1000,
  });

  if (authError) {
    console.error("[PreGen] Failed to fetch auth users:", authError);
    return [];
  }

  // Filter to users active within threshold
  const activeUserIds = authUsers.users
    .filter((user) => {
      if (!user.last_sign_in_at) return false;
      const lastSignIn = new Date(user.last_sign_in_at);
      return lastSignIn >= cutoffDate;
    })
    .map((user) => user.id);

  if (activeUserIds.length === 0) {
    console.log("[PreGen] No active users found");
    return [];
  }

  console.log(`[PreGen] Found ${activeUserIds.length} recently active users`);

  // Filter to users with wardrobe items (onboarding completed)
  const { data: usersWithItems, error: itemsError } = await supabaseAdmin
    .from("wardrobe_items")
    .select("user_id")
    .in("user_id", activeUserIds)
    .eq("processing_status", "completed");

  if (itemsError) {
    console.error("[PreGen] Failed to check wardrobe items:", itemsError);
    return [];
  }

  // Get unique user IDs with items
  const usersWithItemsSet = new Set(usersWithItems?.map((item) => item.user_id) || []);

  // Check which users already have enough unexpired outfits
  const now = new Date().toISOString();
  const eligibleUsers: string[] = [];

  for (const userId of usersWithItemsSet) {
    const { count, error: countError } = await supabaseAdmin
      .from("generated_outfits")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gt("expires_at", now);

    if (countError) {
      console.warn(`[PreGen] Failed to count outfits for user ${userId}:`, countError);
      continue;
    }

    if ((count || 0) < OUTFITS_PER_USER) {
      eligibleUsers.push(userId);
    }
  }

  console.log(`[PreGen] ${eligibleUsers.length} users eligible for pre-generation`);
  return eligibleUsers;
}

/**
 * Generate outfits for a single user
 */
async function generateForUser(userId: string): Promise<number> {
  try {
    // Check how many outfits user currently has
    const now = new Date().toISOString();
    const { count: existingCount } = await supabaseAdmin
      .from("generated_outfits")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gt("expires_at", now);

    const outfitsNeeded = OUTFITS_PER_USER - (existingCount || 0);
    if (outfitsNeeded <= 0) {
      console.log(`[PreGen] User ${userId} already has enough outfits`);
      return 0;
    }

    // Generate outfits
    const outfits = await generateOutfits({
      userId,
      count: outfitsNeeded,
    });

    if (outfits.length === 0) {
      console.log(`[PreGen] Could not generate outfits for user ${userId}`);
      return 0;
    }

    // Save to database
    let savedCount = 0;
    for (const outfit of outfits) {
      const saved = await saveGeneratedOutfit(userId, outfit);
      if (saved) savedCount++;
    }

    console.log(`[PreGen] Generated ${savedCount} outfits for user ${userId}`);
    return savedCount;
  } catch (error) {
    console.error(`[PreGen] Error generating for user ${userId}:`, error);
    return 0;
  }
}

/**
 * Main pre-generation function
 * Called by the cron endpoint
 */
export async function preGenerateOutfits(): Promise<{
  success: boolean;
  usersProcessed: number;
  outfitsGenerated: number;
  errors: number;
}> {
  console.log("[PreGen] Starting pre-generation job...");
  const startTime = Date.now();

  const eligibleUsers = await getEligibleUsers();

  if (eligibleUsers.length === 0) {
    console.log("[PreGen] No users eligible for pre-generation");
    return {
      success: true,
      usersProcessed: 0,
      outfitsGenerated: 0,
      errors: 0,
    };
  }

  let usersProcessed = 0;
  let outfitsGenerated = 0;
  let errors = 0;

  // Process users in batches
  for (let i = 0; i < eligibleUsers.length; i += BATCH_SIZE) {
    const batch = eligibleUsers.slice(i, i + BATCH_SIZE);
    console.log(`[PreGen] Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} users)`);

    // Process batch in parallel
    const results = await Promise.all(
      batch.map(async (userId) => {
        try {
          const count = await generateForUser(userId);
          return { success: true, count };
        } catch (error) {
          console.error(`[PreGen] Failed for user ${userId}:`, error);
          return { success: false, count: 0 };
        }
      })
    );

    for (const result of results) {
      usersProcessed++;
      if (result.success) {
        outfitsGenerated += result.count;
      } else {
        errors++;
      }
    }

    // Small delay between batches to avoid overwhelming the API
    if (i + BATCH_SIZE < eligibleUsers.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(
    `[PreGen] Job completed in ${duration}s: ${usersProcessed} users, ${outfitsGenerated} outfits, ${errors} errors`
  );

  return {
    success: errors === 0,
    usersProcessed,
    outfitsGenerated,
    errors,
  };
}

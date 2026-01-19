/**
 * Weekly Reset Job
 * Runs every Sunday night (Monday 6:00 AM UTC = Sunday 11:59 PM CT)
 *
 * Tasks:
 * 1. Process tier promotions/demotions based on weekly rankings
 * 2. Archive league results
 * 3. Create new league instances for the upcoming week
 * 4. Refresh the leaderboard materialized view
 */

import { supabaseAdmin } from "../services/supabase.js";

// Promotion/demotion rules
// Top 3 in each tier get promoted (except Legend)
// Bottom 3 in each tier get demoted (except Rookie)
const PROMOTION_THRESHOLD = 3;
const DEMOTION_THRESHOLD = 3;

// Tier order for reference
const TIER_ORDER = ["rookie", "seeker", "builder", "maven", "icon", "legend"];

interface WeeklyResetResult {
  success: boolean;
  promotions: number;
  demotions: number;
  leagues_created: number;
  errors: string[];
  duration_ms: number;
}

export async function weeklyReset(): Promise<WeeklyResetResult> {
  const startTime = Date.now();

  console.log("[WeeklyReset] ====================================");
  console.log("[WeeklyReset] Starting weekly reset job");
  console.log("[WeeklyReset] ====================================");

  const result: WeeklyResetResult = {
    success: true,
    promotions: 0,
    demotions: 0,
    leagues_created: 0,
    errors: [],
    duration_ms: 0,
  };

  try {
    // Step 1: Refresh leaderboard to ensure we have latest data
    console.log("[WeeklyReset] Refreshing leaderboard...");
    const { error: refreshError } = await supabaseAdmin.rpc("refresh_weekly_leaderboard");

    if (refreshError) {
      result.errors.push(`Leaderboard refresh error: ${refreshError.message}`);
      console.error("[WeeklyReset] Leaderboard refresh failed:", refreshError);
    }

    // Step 2: Get all active schools
    const { data: schools, error: schoolsError } = await supabaseAdmin
      .from("schools")
      .select("id, name")
      .eq("is_active", true);

    if (schoolsError) {
      result.errors.push(`Schools fetch error: ${schoolsError.message}`);
      console.error("[WeeklyReset] Failed to fetch schools:", schoolsError);
      result.success = false;
      result.duration_ms = Date.now() - startTime;
      return result;
    }

    // Step 3: Process each school
    for (const school of schools || []) {
      console.log(`[WeeklyReset] Processing school: ${school.name}`);

      // Process each tier (except Legend for promotion and Rookie for demotion)
      for (const tier of TIER_ORDER) {
        await processTierPromotions(school.id, tier, result);
      }

      // Step 4: Create new leagues for next week
      await createNextWeekLeagues(school.id, result);
    }

    console.log("[WeeklyReset] ====================================");
    console.log(`[WeeklyReset] COMPLETE! Promotions: ${result.promotions}, Demotions: ${result.demotions}`);
    console.log("[WeeklyReset] ====================================");
  } catch (error) {
    result.success = false;
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Fatal: ${errorMsg}`);
    console.error("[WeeklyReset] FATAL ERROR:", error);
  }

  result.duration_ms = Date.now() - startTime;
  return result;
}

/**
 * Process promotions and demotions for a specific tier in a school
 */
async function processTierPromotions(
  schoolId: string,
  tier: string,
  result: WeeklyResetResult
): Promise<void> {
  try {
    // Get ranked users in this tier
    const { data: rankedUsers, error } = await supabaseAdmin
      .from("weekly_leaderboard")
      .select("user_id, rank, score")
      .eq("school_id", schoolId)
      .eq("tier", tier)
      .order("rank", { ascending: true });

    if (error) {
      result.errors.push(`Tier ${tier} fetch error: ${error.message}`);
      return;
    }

    if (!rankedUsers || rankedUsers.length === 0) {
      return; // No users in this tier
    }

    // Promotions: Top 3 get promoted (except Legend tier)
    if (tier !== "legend") {
      const promotionCandidates = rankedUsers
        .filter((u) => u.rank <= PROMOTION_THRESHOLD && u.score > 0)
        .map((u) => u.user_id);

      for (const userId of promotionCandidates) {
        const { data: newTier, error: promoteError } = await supabaseAdmin.rpc(
          "promote_user_tier",
          { target_user_id: userId }
        );

        if (promoteError) {
          result.errors.push(`Promotion error for ${userId}: ${promoteError.message}`);
        } else {
          result.promotions++;
          console.log(`[WeeklyReset] Promoted ${userId} from ${tier} to ${newTier}`);
        }
      }
    }

    // Demotions: Bottom 3 get demoted (except Rookie tier)
    if (tier !== "rookie") {
      const totalUsers = rankedUsers.length;
      const demotionThreshold = totalUsers - DEMOTION_THRESHOLD;

      // Only demote if there are enough users (more than 6)
      if (totalUsers > 6) {
        const demotionCandidates = rankedUsers
          .filter((u) => u.rank > demotionThreshold)
          .map((u) => u.user_id);

        for (const userId of demotionCandidates) {
          const { data: newTier, error: demoteError } = await supabaseAdmin.rpc(
            "demote_user_tier",
            { target_user_id: userId }
          );

          if (demoteError) {
            result.errors.push(`Demotion error for ${userId}: ${demoteError.message}`);
          } else {
            result.demotions++;
            console.log(`[WeeklyReset] Demoted ${userId} from ${tier} to ${newTier}`);
          }
        }
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Tier ${tier} processing error: ${errorMsg}`);
    console.error(`[WeeklyReset] Error processing tier ${tier}:`, error);
  }
}

/**
 * Create league instances for the next week
 */
async function createNextWeekLeagues(
  schoolId: string,
  result: WeeklyResetResult
): Promise<void> {
  try {
    const nextWeekStart = getNextWeekStart();

    // Create a league for each tier
    for (const tier of TIER_ORDER) {
      const { error } = await supabaseAdmin
        .from("leagues")
        .upsert({
          school_id: schoolId,
          tier,
          week_start: nextWeekStart,
        }, {
          onConflict: "school_id,tier,week_start",
        });

      if (error) {
        result.errors.push(`League creation error for ${tier}: ${error.message}`);
      } else {
        result.leagues_created++;
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`League creation error: ${errorMsg}`);
    console.error("[WeeklyReset] Error creating leagues:", error);
  }
}

/**
 * Get next week's Monday date in YYYY-MM-DD format
 */
function getNextWeekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  // Days until next Monday
  const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
  const nextMonday = new Date(now);
  nextMonday.setUTCDate(now.getUTCDate() + daysUntilMonday);
  nextMonday.setUTCHours(0, 0, 0, 0);
  return nextMonday.toISOString().split("T")[0];
}

/**
 * Daily Gamification Reset Cron Job
 * Runs at midnight (user's timezone ideally, but for simplicity UTC)
 *
 * Tasks:
 * 1. Reset daily_xp_earned to 0 for all users
 * 2. Auto-freeze check for users who missed yesterday
 * 3. Generate daily challenges for active users
 * 4. Generate weekly challenges (Monday only)
 */

import { supabaseAdmin } from "../services/supabase.js";

interface ResetResult {
  success: boolean;
  users_reset: number;
  challenges_generated: number;
  weekly_challenges_generated: number;
  auto_freezes_applied: number;
  streaks_broken: number;
  errors: string[];
  duration_ms: number;
}

export async function dailyGamificationReset(): Promise<ResetResult> {
  const startTime = Date.now();

  console.log("[DailyReset] ====================================");
  console.log("[DailyReset] Starting daily gamification reset");
  console.log("[DailyReset] ====================================");

  const result: ResetResult = {
    success: true,
    users_reset: 0,
    challenges_generated: 0,
    weekly_challenges_generated: 0,
    auto_freezes_applied: 0,
    streaks_broken: 0,
    errors: [],
    duration_ms: 0,
  };

  try {
    // Step 1: Reset daily_xp_earned for all users
    console.log("[DailyReset] Resetting daily XP for all users...");
    const { data: resetData, error: resetError } = await supabaseAdmin
      .from("user_gamification")
      .update({ daily_xp_earned: 0 })
      .neq("daily_xp_earned", 0)
      .select("user_id");

    if (resetError) {
      result.errors.push(`Reset XP error: ${resetError.message}`);
      console.error("[DailyReset] Error resetting XP:", resetError);
    } else {
      result.users_reset = resetData?.length || 0;
      console.log(`[DailyReset] Reset daily XP for ${result.users_reset} users`);
    }

    // Step 2: Check for users who missed yesterday and apply auto-freeze or break streak
    console.log("[DailyReset] Checking for missed streaks...");
    await handleMissedStreaks(result);

    // Step 3: Get active users (last 7 days) for challenge generation
    console.log("[DailyReset] Generating daily challenges for active users...");
    const { data: activeUsers, error: activeError } = await supabaseAdmin
      .from("user_gamification")
      .select("user_id")
      .gte("updated_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    if (activeError) {
      result.errors.push(`Active users error: ${activeError.message}`);
      console.error("[DailyReset] Error fetching active users:", activeError);
    } else {
      const userIds = activeUsers?.map((u) => u.user_id) || [];
      console.log(`[DailyReset] Found ${userIds.length} active users`);

      // Generate daily challenges for each user
      for (const userId of userIds) {
        try {
          await supabaseAdmin.rpc("generate_daily_challenges", {
            p_user_id: userId,
          });
          result.challenges_generated++;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Unknown error";
          console.error(`[DailyReset] Error generating challenges for ${userId}:`, errorMsg);
        }
      }
      console.log(`[DailyReset] Generated challenges for ${result.challenges_generated} users`);

      // Step 4: Generate weekly challenges if it's Monday
      const today = new Date();
      if (today.getUTCDay() === 1) {
        console.log("[DailyReset] It's Monday - generating weekly challenges...");
        for (const userId of userIds) {
          try {
            await supabaseAdmin.rpc("generate_weekly_challenge", {
              p_user_id: userId,
            });
            result.weekly_challenges_generated++;
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : "Unknown error";
            console.error(`[DailyReset] Error generating weekly challenge for ${userId}:`, errorMsg);
          }
        }
        console.log(`[DailyReset] Generated weekly challenges for ${result.weekly_challenges_generated} users`);
      }
    }

    console.log("[DailyReset] ====================================");
    console.log(
      `[DailyReset] COMPLETE! Users: ${result.users_reset}, Challenges: ${result.challenges_generated}, Freezes: ${result.auto_freezes_applied}, Broken: ${result.streaks_broken}`
    );
    console.log("[DailyReset] ====================================");
  } catch (error) {
    result.success = false;
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Fatal: ${errorMsg}`);
    console.error("[DailyReset] FATAL ERROR:", error);
  }

  result.duration_ms = Date.now() - startTime;
  return result;
}

/**
 * Get yesterday's date string (YYYY-MM-DD) in a specific timezone
 */
function getYesterdayInTimezone(timezone: string): string {
  const now = new Date();
  // Get current date parts in user's timezone
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const todayStr = formatter.format(now); // YYYY-MM-DD format
  const today = new Date(todayStr + "T00:00:00");
  today.setDate(today.getDate() - 1);
  return today.toISOString().split("T")[0];
}

/**
 * Get today's date string (YYYY-MM-DD) in a specific timezone
 */
function getTodayInTimezone(timezone: string): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now); // YYYY-MM-DD format
}

/**
 * Handle users who missed yesterday's activity
 * Apply auto-freeze if available, otherwise break streak
 * Uses each user's timezone for accurate date comparisons
 */
async function handleMissedStreaks(result: ResetResult): Promise<void> {
  // Find users with active streaks - include timezone for per-user date calculation
  const { data: usersWithStreaks, error: streakError } = await supabaseAdmin
    .from("user_gamification")
    .select("user_id, current_streak, streak_freezes_available, last_active_date, timezone")
    .gt("current_streak", 0);

  if (streakError) {
    result.errors.push(`Streak check error: ${streakError.message}`);
    console.error("[DailyReset] Error checking streaks:", streakError);
    return;
  }

  for (const user of usersWithStreaks || []) {
    const userTimezone = user.timezone || "America/Chicago";
    const yesterdayStr = getYesterdayInTimezone(userTimezone);
    const todayStr = getTodayInTimezone(userTimezone);

    // Skip if user was active today (in their timezone) - streak is safe
    if (user.last_active_date === todayStr) {
      continue;
    }

    // Skip if user was active yesterday (in their timezone) - streak is safe
    if (user.last_active_date === yesterdayStr) {
      continue;
    }

    // User missed yesterday in their timezone - check if we can auto-freeze
    if (user.streak_freezes_available > 0) {
      // Apply auto-freeze
      const { error: freezeError } = await supabaseAdmin
        .from("user_gamification")
        .update({
          streak_freezes_available: user.streak_freezes_available - 1,
          last_active_date: yesterdayStr, // Pretend they were active yesterday
        })
        .eq("user_id", user.user_id);

      if (freezeError) {
        result.errors.push(`Auto-freeze error for ${user.user_id}: ${freezeError.message}`);
      } else {
        result.auto_freezes_applied++;
        console.log(`[DailyReset] Applied auto-freeze for user ${user.user_id} (tz: ${userTimezone})`);

        // Log to daily_activity
        await supabaseAdmin.from("daily_activity").upsert({
          user_id: user.user_id,
          activity_date: yesterdayStr,
          freeze_used: true,
          streak_maintained: true,
        }, { onConflict: "user_id,activity_date" });
      }
    } else {
      // No freezes available - break streak
      const { error: breakError } = await supabaseAdmin
        .from("user_gamification")
        .update({
          streak_before_loss: user.current_streak, // Save streak value before wiping
          current_streak: 0,
          streak_lost_at: new Date().toISOString(),
        })
        .eq("user_id", user.user_id);

      if (breakError) {
        result.errors.push(`Streak break error for ${user.user_id}: ${breakError.message}`);
      } else {
        result.streaks_broken++;
        console.log(`[DailyReset] Streak broken for user ${user.user_id} (was ${user.current_streak} days, tz: ${userTimezone})`);
      }
    }
  }
}

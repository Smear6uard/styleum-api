/**
 * Gamification Routes
 * Complete Duolingo-style gamification API
 */

import { Hono } from "hono";
import { getUserId } from "../middleware/auth.js";
import { GamificationService } from "../services/gamification.js";

type Variables = {
  userId: string;
  email: string;
};

const gamification = new Hono<{ Variables: Variables }>();

/**
 * GET /stats - Get user's gamification stats
 * Returns flat structure for iOS compatibility
 */
gamification.get("/stats", async (c) => {
  const userId = getUserId(c);

  const stats = await GamificationService.getStats(userId);

  if (!stats) {
    return c.json({ error: "Failed to fetch gamification stats" }, 500);
  }

  // Check if streak was frozen today by querying daily_activity
  const today = new Date().toISOString().split("T")[0];
  const { data: todayActivity } = await (await import("../services/supabase.js")).supabaseAdmin
    .from("daily_activity")
    .select("freeze_used")
    .eq("user_id", userId)
    .eq("activity_date", today)
    .single();

  const streakFrozenToday = todayActivity?.freeze_used ?? false;

  // Calculate hours until streak loss using user's timezone
  const hasEngagedToday = stats.daily_xp_earned > 0;
  const userTimezone = stats.timezone || "America/Chicago";

  // Helper to get hours until midnight in user's timezone
  function getHoursUntilStreakLoss(timezone: string, engaged: boolean): number {
    if (engaged) {
      // User engaged today, they're safe - show hours until tomorrow's deadline
      const now = new Date();
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = formatter.formatToParts(now);
      const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
      // Hours until end of tomorrow (they have until tomorrow midnight)
      return 24 + (24 - hour);
    }

    // User hasn't engaged today - calculate hours until midnight in their timezone
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0");
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0");

    // Hours until midnight (24:00) in user's timezone
    const hoursLeft = 23 - hour + (minute > 0 ? 0 : 1);
    return Math.max(0, hoursLeft);
  }

  const hoursUntilStreakLoss = getHoursUntilStreakLoss(userTimezone, hasEngagedToday);

  // Return flat structure that iOS expects
  return c.json({
    current_streak: stats.current_streak,
    longest_streak: stats.longest_streak,
    total_days_active: stats.daily_goals_streak,
    streak_freezes: stats.streak_freezes,
    xp: stats.total_xp,
    level: stats.level,
    daily_xp_earned: stats.daily_xp_earned,
    daily_goal_xp: stats.daily_xp_goal,
    has_engaged_today: hasEngagedToday,
    streak_frozen_today: streakFrozenToday,
    hours_until_streak_loss: hoursUntilStreakLoss,
  });
});

/**
 * GET /levels - Get all level definitions with titles
 */
gamification.get("/levels", async (c) => {
  const levels = await GamificationService.getLevels();
  return c.json({ levels });
});

/**
 * GET /achievements - Get all achievements with progress
 * Returns wrapped object for iOS compatibility
 */
gamification.get("/achievements", async (c) => {
  const userId = getUserId(c);

  try {
    const achievements = await GamificationService.getAchievements(userId);

    // Transform to iOS expected format with target instead of requirement_value
    const transformedAchievements = achievements.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      category: a.category,
      xp_reward: a.xp_reward,
      is_unlocked: a.is_unlocked,
      progress: a.progress ?? 0,
      target: a.requirement_value, // iOS expects "target" not "requirement_value"
    }));

    // Return wrapped object as iOS expects
    return c.json({ achievements: transformedAchievements });
  } catch (error) {
    console.error("[Gamification] Error in /achievements route:", error);
    return c.json({ error: "Failed to fetch achievements", details: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

/**
 * POST /achievements/:id/seen - Mark an achievement as seen
 * Returns 204 No Content for iOS compatibility
 */
gamification.post("/achievements/:id/seen", async (c) => {
  const userId = getUserId(c);
  const achievementId = c.req.param("id");

  const success = await GamificationService.markAchievementSeen(
    userId,
    achievementId
  );

  if (!success) {
    return c.json({ error: "Failed to mark achievement as seen" }, 500);
  }

  // Return 204 No Content as iOS expects
  return c.body(null, 204);
});

/**
 * GET /challenges/daily - Get today's daily challenges
 * Returns 3 challenges with progress (iOS compatible format)
 */
gamification.get("/challenges/daily", async (c) => {
  const userId = getUserId(c);

  const challenges = await GamificationService.getDailyChallenges(userId);

  // Calculate today's date and reset time (4am UTC tomorrow)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const resetTime = new Date(today);
  resetTime.setUTCDate(resetTime.getUTCDate() + 1);
  resetTime.setUTCHours(4, 0, 0, 0);
  const resetsAtISO = resetTime.toISOString();

  // Transform challenges to iOS expected format
  const transformedChallenges = challenges.map((ch) => ({
    id: ch.id,
    name: ch.name, // iOS expects "name"
    description: ch.description,
    progress: ch.progress,
    target: ch.target,
    xp_reward: ch.xp_reward,
    is_completed: ch.is_completed,
    is_claimed: ch.is_claimed,
  }));

  const completedCount = challenges.filter((ch) => ch.is_completed).length;
  const totalXP = challenges.reduce((sum, ch) => sum + ch.xp_reward, 0);

  return c.json({
    challenges: transformedChallenges,
    total_xp_available: totalXP,
    completed_count: completedCount,
    date: todayISO,
    resets_at: resetsAtISO,
  });
});

/**
 * GET /challenges/weekly - Get this week's challenge (iOS compatible format)
 */
gamification.get("/challenges/weekly", async (c) => {
  const userId = getUserId(c);

  const rawChallenge = await GamificationService.getWeeklyChallenge(userId);

  if (!rawChallenge) {
    return c.json({ challenge: null });
  }

  // Calculate week end (Sunday 4am UTC)
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const weekEnd = new Date(now);
  weekEnd.setDate(now.getDate() + daysUntilSunday + 1);
  weekEnd.setUTCHours(4, 0, 0, 0);

  // Transform to iOS expected format
  const challenge = {
    id: rawChallenge.id,
    title: rawChallenge.name,
    description: rawChallenge.description,
    target: rawChallenge.target,
    progress: rawChallenge.progress,
    xp_reward: rawChallenge.xp_reward,
    ends_at: weekEnd.toISOString(),
    completed_at: rawChallenge.completed_at,
  };

  return c.json({ challenge });
});

/**
 * POST /challenges/:id/claim - Claim a completed challenge
 * Query param: weekly=true for weekly challenges
 * Returns updated challenge object for iOS compatibility
 */
gamification.post("/challenges/:id/claim", async (c) => {
  const userId = getUserId(c);
  const challengeId = c.req.param("id");
  const isWeekly = c.req.query("weekly") === "true";

  const result = await GamificationService.claimChallenge(
    userId,
    challengeId,
    isWeekly
  );

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  // Fetch the updated challenge to include in response
  let challenge = null;
  if (!isWeekly) {
    const challenges = await GamificationService.getDailyChallenges(userId);
    const foundChallenge = challenges.find((ch) => ch.id === challengeId);
    if (foundChallenge) {
      // Transform to iOS format
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      challenge = {
        id: foundChallenge.id,
        type: foundChallenge.challenge_type,
        title: foundChallenge.name,
        description: foundChallenge.description,
        target: foundChallenge.target,
        progress: foundChallenge.progress,
        xp_reward: foundChallenge.xp_reward,
        icon_name: foundChallenge.icon,
        completed_at: foundChallenge.completed_at,
        date: today.toISOString(),
      };
    }
  }

  return c.json({
    success: true,
    challenge,
    xp_awarded: isWeekly ? 150 : result.daily_xp,
    new_total_xp: result.new_total_xp,
    level_up: result.level_up,
    new_level: result.new_level,
  });
});

/**
 * GET /streak - Get current streak info
 * Includes freeze count, restore eligibility
 */
gamification.get("/streak", async (c) => {
  const userId = getUserId(c);

  // Check streak to trigger any needed updates
  await GamificationService.checkStreak(userId);
  const stats = await GamificationService.getStats(userId);

  if (!stats) {
    return c.json({ error: "Failed to fetch streak info" }, 500);
  }

  // Check restore eligibility
  let canRestore = false;
  let restoreExpiresAt = null;
  let lastActiveDate: string | null = null;

  // Query for streak_lost_at and last_streak_activity_date
  const { data: gamData } = await (await import("../services/supabase.js")).supabaseAdmin
    .from("user_gamification")
    .select("streak_lost_at, last_streak_activity_date")
    .eq("user_id", userId)
    .single();

  if (gamData?.streak_lost_at && stats.is_pro) {
    const lostAt = new Date(gamData.streak_lost_at);
    const hoursAgo = (Date.now() - lostAt.getTime()) / (1000 * 60 * 60);
    canRestore = hoursAgo <= 24;
    if (canRestore) {
      restoreExpiresAt = new Date(lostAt.getTime() + 24 * 60 * 60 * 1000).toISOString();
    }
  }

  lastActiveDate = gamData?.last_streak_activity_date || null;

  // Calculate if streak is at risk (not maintained today)
  const today = new Date().toISOString().split("T")[0];
  const streakAtRisk = stats.current_streak > 0 && lastActiveDate !== today;

  // Return iOS expected format
  return c.json({
    current_streak: stats.current_streak,
    longest_streak: stats.longest_streak,
    streak_freezes: stats.streak_freezes,
    last_active_date: lastActiveDate,
    streak_at_risk: streakAtRisk,
    max_freezes: stats.max_streak_freezes,
    can_restore: canRestore,
    restore_expires_at: restoreExpiresAt,
    restore_cost_xp: 500,
    is_pro: stats.is_pro,
  });
});

/**
 * POST /streak/restore - Restore a lost streak (Pro only, 500 XP)
 */
gamification.post("/streak/restore", async (c) => {
  const userId = getUserId(c);

  const result = await GamificationService.restoreStreak(userId);

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({
    success: true,
    restored_streak: result.new_streak,
    xp_spent: result.xp_cost,
    new_total_xp: result.new_total_xp,
  });
});

/**
 * POST /streak-freeze - Use a streak freeze to protect today's streak
 * Returns updated stats (iOS compatible)
 */
gamification.post("/streak-freeze", async (c) => {
  const userId = getUserId(c);

  const stats = await GamificationService.getStats(userId);

  if (!stats) {
    return c.json({ error: "Failed to fetch gamification stats" }, 500);
  }

  // Check if user has streak freezes available
  if (stats.streak_freezes <= 0) {
    return c.json({ error: "No streak freezes available" }, 400);
  }

  // Streak freezes are used automatically when needed, so just return current stats
  // This endpoint confirms the freeze is available for protection
  const hasEngagedToday = stats.daily_xp_earned > 0;

  const today = new Date().toISOString().split("T")[0];
  const { data: todayActivity } = await (await import("../services/supabase.js")).supabaseAdmin
    .from("daily_activity")
    .select("freeze_used")
    .eq("user_id", userId)
    .eq("activity_date", today)
    .single();

  const streakFrozenToday = todayActivity?.freeze_used ?? false;

  const now = new Date();
  const resetTime = new Date(now);
  resetTime.setUTCDate(resetTime.getUTCDate() + 1);
  resetTime.setUTCHours(4, 0, 0, 0);
  const hoursUntilStreakLoss = Math.max(0, Math.round((resetTime.getTime() - now.getTime()) / (1000 * 60 * 60)));

  return c.json({
    current_streak: stats.current_streak,
    longest_streak: stats.longest_streak,
    total_days_active: stats.daily_goals_streak,
    streak_freezes: stats.streak_freezes,
    xp: stats.total_xp,
    level: stats.level,
    daily_xp_earned: stats.daily_xp_earned,
    daily_goal_xp: stats.daily_xp_goal,
    has_engaged_today: hasEngagedToday,
    streak_frozen_today: streakFrozenToday,
    hours_until_streak_loss: hoursUntilStreakLoss,
  });
});

/**
 * POST /use-streak-freeze - Manually use a streak freeze to protect a broken streak
 * Uses a freeze to prevent streak loss when user hasn't engaged today
 * Returns updated stats and freeze info
 */
gamification.post("/use-streak-freeze", async (c) => {
  const userId = getUserId(c);

  try {
    const { supabaseAdmin } = await import("../services/supabase.js");
    const { isUserPro } = await import("../services/supabase.js");
    const { TIER_LIMITS } = await import("../constants/tiers.js");

    // Get current gamification state
    const { data: gamification, error: fetchError } = await supabaseAdmin
      .from("user_gamification")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (fetchError || !gamification) {
      return c.json({ error: "Gamification data not found" }, 404);
    }

    // Check if user has a streak to protect
    if (gamification.current_streak === 0) {
      return c.json({ error: "No streak to protect" }, 400);
    }

    // Check if streak is at risk (last activity was before today)
    const today = new Date().toISOString().split("T")[0];
    const lastActivityDate = gamification.last_streak_activity_date;

    if (lastActivityDate === today) {
      return c.json({ error: "Streak is not at risk - you've already engaged today" }, 400);
    }

    // Check if user has freezes available
    const freezesAvailable = gamification.streak_freezes_available || 0;
    if (freezesAvailable <= 0) {
      // Check tier to give appropriate error message
      const isPro = await isUserPro(userId);
      const maxFreezes = isPro ? TIER_LIMITS.pro.streakFreezesPerMonth : TIER_LIMITS.free.streakFreezesPerMonth;

      return c.json({
        error: "No streak freezes available",
        upgrade_required: !isPro,
        max_freezes: maxFreezes,
        message: isPro
          ? "You've used all your streak freezes this month"
          : "Upgrade to Pro for more streak freezes"
      }, 403);
    }

    // Use the freeze
    const { error: updateError } = await supabaseAdmin
      .from("user_gamification")
      .update({
        streak_freezes_available: freezesAvailable - 1,
        last_streak_activity_date: today, // Update to today to preserve streak
      })
      .eq("user_id", userId);

    if (updateError) {
      console.error("[Gamification] Error using streak freeze:", updateError);
      return c.json({ error: "Failed to use streak freeze" }, 500);
    }

    // Record freeze usage in daily_activity
    await supabaseAdmin
      .from("daily_activity")
      .upsert({
        user_id: userId,
        activity_date: today,
        freeze_used: true,
      }, { onConflict: "user_id,activity_date" });

    return c.json({
      success: true,
      streak_preserved: true,
      current_streak: gamification.current_streak,
      freezes_remaining: freezesAvailable - 1,
      message: "Streak freeze used successfully! Your streak is protected."
    });
  } catch (err) {
    console.error("[Gamification] Exception using streak freeze:", err);
    return c.json({ error: "Failed to use streak freeze" }, 500);
  }
});

/**
 * POST /restore-streak - Alias for /streak/restore (iOS compatible path)
 */
gamification.post("/restore-streak", async (c) => {
  const userId = getUserId(c);

  const result = await GamificationService.restoreStreak(userId);

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  // Return stats format as iOS expects
  const stats = await GamificationService.getStats(userId);

  if (!stats) {
    return c.json({ error: "Failed to fetch gamification stats" }, 500);
  }

  const hasEngagedToday = stats.daily_xp_earned > 0;

  const today = new Date().toISOString().split("T")[0];
  const { data: todayActivity } = await (await import("../services/supabase.js")).supabaseAdmin
    .from("daily_activity")
    .select("freeze_used")
    .eq("user_id", userId)
    .eq("activity_date", today)
    .single();

  const streakFrozenToday = todayActivity?.freeze_used ?? false;

  const now = new Date();
  const resetTime = new Date(now);
  resetTime.setUTCDate(resetTime.getUTCDate() + 1);
  resetTime.setUTCHours(4, 0, 0, 0);
  const hoursUntilStreakLoss = Math.max(0, Math.round((resetTime.getTime() - now.getTime()) / (1000 * 60 * 60)));

  return c.json({
    current_streak: stats.current_streak,
    longest_streak: stats.longest_streak,
    total_days_active: stats.daily_goals_streak,
    streak_freezes: stats.streak_freezes,
    xp: stats.total_xp,
    level: stats.level,
    daily_xp_earned: stats.daily_xp_earned,
    daily_goal_xp: stats.daily_xp_goal,
    has_engaged_today: hasEngagedToday,
    streak_frozen_today: streakFrozenToday,
    hours_until_streak_loss: hoursUntilStreakLoss,
  });
});

/**
 * GET /activity/calendar - Get activity calendar for a month
 * Query params: year (YYYY), month (1-12)
 */
gamification.get("/activity/calendar", async (c) => {
  const userId = getUserId(c);

  const now = new Date();
  const year = parseInt(c.req.query("year") ?? String(now.getFullYear()));
  const month = parseInt(c.req.query("month") ?? String(now.getMonth() + 1));

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return c.json({ error: "Invalid year or month" }, 400);
  }

  const calendar = await GamificationService.getActivityCalendar(
    userId,
    year,
    month
  );

  // Calculate month stats
  const totalXP = calendar.reduce((sum, day) => sum + day.xp_earned, 0);
  const activeDays = calendar.length;
  const streakDays = calendar.filter((day) => day.streak_maintained).length;
  const goalDays = calendar.filter((day) => day.daily_goal_met).length;

  return c.json({
    year,
    month,
    days: calendar,
    stats: {
      total_xp: totalXP,
      active_days: activeDays,
      streak_days: streakDays,
      goal_days: goalDays,
    },
  });
});

/**
 * GET /xp/history - Get XP transaction history
 * Query params: limit (default 50), offset (default 0)
 */
gamification.get("/xp/history", async (c) => {
  const userId = getUserId(c);

  const limit = Math.min(100, parseInt(c.req.query("limit") ?? "50"));
  const offset = parseInt(c.req.query("offset") ?? "0");

  if (isNaN(limit) || isNaN(offset) || limit < 1 || offset < 0) {
    return c.json({ error: "Invalid limit or offset" }, 400);
  }

  const transactions = await GamificationService.getXPHistory(
    userId,
    limit,
    offset
  );

  return c.json({
    transactions,
    limit,
    offset,
    has_more: transactions.length === limit,
  });
});

/**
 * GET /leaderboard - Get top users by XP
 * Query param: limit (default 50, max 100)
 */
gamification.get("/leaderboard", async (c) => {
  const limit = Math.min(100, parseInt(c.req.query("limit") ?? "50"));

  const leaderboard = await GamificationService.getLeaderboard(limit);

  return c.json({ leaderboard });
});

// ============================================================================
// ROUTE ALIASES (iOS compatibility)
// ============================================================================

/**
 * GET /daily-challenges - Alias for /challenges/daily (iOS compatible format)
 */
gamification.get("/daily-challenges", async (c) => {
  const userId = getUserId(c);

  const challenges = await GamificationService.getDailyChallenges(userId);

  // Calculate today's date and reset time (4am UTC tomorrow)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayISO = today.toISOString();

  const resetTime = new Date(today);
  resetTime.setUTCDate(resetTime.getUTCDate() + 1);
  resetTime.setUTCHours(4, 0, 0, 0);
  const resetsAtISO = resetTime.toISOString();

  // Transform challenges to iOS expected format
  const transformedChallenges = challenges.map((ch) => ({
    id: ch.id,
    name: ch.name, // iOS expects "name"
    description: ch.description,
    progress: ch.progress,
    target: ch.target,
    xp_reward: ch.xp_reward,
    is_completed: ch.is_completed,
    is_claimed: ch.is_claimed,
  }));

  const completedCount = challenges.filter((ch) => ch.is_completed).length;
  const totalXP = challenges.reduce((sum, ch) => sum + ch.xp_reward, 0);

  return c.json({
    challenges: transformedChallenges,
    total_xp_available: totalXP,
    completed_count: completedCount,
    date: todayISO,
    resets_at: resetsAtISO,
  });
});

/**
 * GET /weekly-challenge - Alias for /challenges/weekly (iOS compatible format)
 */
gamification.get("/weekly-challenge", async (c) => {
  const userId = getUserId(c);

  const rawChallenge = await GamificationService.getWeeklyChallenge(userId);

  if (!rawChallenge) {
    return c.json({ challenge: null });
  }

  // Calculate week end (Sunday 4am UTC)
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const weekEnd = new Date(now);
  weekEnd.setDate(now.getDate() + daysUntilSunday + 1); // Monday 4am
  weekEnd.setUTCHours(4, 0, 0, 0);

  // Transform to iOS expected format
  const challenge = {
    id: rawChallenge.id,
    title: rawChallenge.name, // Renamed from name
    description: rawChallenge.description,
    target: rawChallenge.target,
    progress: rawChallenge.progress,
    xp_reward: rawChallenge.xp_reward,
    ends_at: weekEnd.toISOString(),
    completed_at: rawChallenge.completed_at,
  };

  return c.json({ challenge });
});

/**
 * GET /activity-history - Get activity for last N days
 * Query param: days (default 7)
 * iOS compatible format
 */
gamification.get("/activity-history", async (c) => {
  const userId = getUserId(c);

  const days = parseInt(c.req.query("days") ?? "7");

  if (isNaN(days) || days < 1 || days > 365) {
    return c.json({ error: "Invalid days parameter (1-365)" }, 400);
  }

  const activityDays = await GamificationService.getActivityByDays(userId, days);

  // Transform to iOS expected format
  const activities = activityDays.map((day) => ({
    date: new Date(day.activity_date).toISOString(),
    has_activity: true,
    xp_earned: day.xp_earned,
    outfits_worn: day.outfits_worn,
    items_added: day.items_added,
  }));

  return c.json({
    activities,
  });
});

export default gamification;

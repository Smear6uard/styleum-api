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

  // Return flat structure that iOS expects
  return c.json({
    current_streak: stats.current_streak,
    longest_streak: stats.longest_streak,
    total_days_active: stats.daily_goals_streak, // Days where daily goal was met
    streak_freezes: stats.streak_freezes,
    xp: stats.total_xp,
    level: stats.level,
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
 * Grouped by category for easy display
 */
gamification.get("/achievements", async (c) => {
  const userId = getUserId(c);

  try {
    const achievements = await GamificationService.getAchievements(userId);

    // Group by category
    const grouped = achievements.reduce(
      (acc, achievement) => {
        const category = achievement.category || "other";
        if (!acc[category]) {
          acc[category] = [];
        }
        acc[category].push(achievement);
        return acc;
      },
      {} as Record<string, typeof achievements>
    );

    // Calculate stats
    const totalCount = achievements.length;
    const unlockedCount = achievements.filter((a) => a.is_unlocked).length;
    const unseenCount = achievements.filter((a) => a.is_unlocked && !a.is_seen).length;

    return c.json({
      achievements: grouped,
      total: totalCount,
      unlocked: unlockedCount,
      unseen: unseenCount,
    });
  } catch (error) {
    console.error("[Gamification] Error in /achievements route:", error);
    return c.json({ error: "Failed to fetch achievements", details: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

/**
 * POST /achievements/:id/seen - Mark an achievement as seen
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

  return c.json({ success: true });
});

/**
 * GET /challenges/daily - Get today's daily challenges
 * Returns 3 challenges with progress
 */
gamification.get("/challenges/daily", async (c) => {
  const userId = getUserId(c);

  const challenges = await GamificationService.getDailyChallenges(userId);

  // Calculate stats
  const completedCount = challenges.filter((ch) => ch.is_completed).length;
  const claimedCount = challenges.filter((ch) => ch.is_claimed).length;
  const totalXP = challenges.reduce((sum, ch) => sum + ch.xp_reward, 0);
  const claimedXP = challenges
    .filter((ch) => ch.is_claimed)
    .reduce((sum, ch) => sum + ch.xp_reward, 0);

  return c.json({
    challenges,
    completed: completedCount,
    claimed: claimedCount,
    total_xp_available: totalXP,
    xp_claimed: claimedXP,
  });
});

/**
 * GET /challenges/weekly - Get this week's challenge
 */
gamification.get("/challenges/weekly", async (c) => {
  const userId = getUserId(c);

  const challenge = await GamificationService.getWeeklyChallenge(userId);

  return c.json({ challenge });
});

/**
 * POST /challenges/:id/claim - Claim a completed challenge
 * Query param: weekly=true for weekly challenges
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

  return c.json({
    success: true,
    xp_awarded: isWeekly ? 150 : result.daily_xp, // Approximate based on type
    new_total_xp: result.new_total_xp,
    level_up: result.level_up,
    new_level: result.new_level,
    daily_goal_met: result.daily_goal_met,
  });
});

/**
 * GET /streak - Get current streak info
 * Includes freeze count, restore eligibility
 */
gamification.get("/streak", async (c) => {
  const userId = getUserId(c);

  const streakResult = await GamificationService.checkStreak(userId);
  const stats = await GamificationService.getStats(userId);

  if (!stats) {
    return c.json({ error: "Failed to fetch streak info" }, 500);
  }

  // Check restore eligibility
  let canRestore = false;
  let restoreExpiresAt = null;

  // Query for streak_lost_at
  const { data: gamData } = await (await import("../services/supabase.js")).supabaseAdmin
    .from("user_gamification")
    .select("streak_lost_at")
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

  return c.json({
    current_streak: streakResult.current_streak,
    longest_streak: streakResult.longest_streak,
    streak_freezes: streakResult.freezes_remaining,
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
 * GET /daily-challenges - Alias for /challenges/daily
 */
gamification.get("/daily-challenges", async (c) => {
  const userId = getUserId(c);

  const challenges = await GamificationService.getDailyChallenges(userId);

  const completedCount = challenges.filter((ch) => ch.is_completed).length;
  const claimedCount = challenges.filter((ch) => ch.is_claimed).length;
  const totalXP = challenges.reduce((sum, ch) => sum + ch.xp_reward, 0);
  const claimedXP = challenges
    .filter((ch) => ch.is_claimed)
    .reduce((sum, ch) => sum + ch.xp_reward, 0);

  return c.json({
    challenges,
    completed: completedCount,
    claimed: claimedCount,
    total_xp_available: totalXP,
    xp_claimed: claimedXP,
  });
});

/**
 * GET /weekly-challenge - Alias for /challenges/weekly
 */
gamification.get("/weekly-challenge", async (c) => {
  const userId = getUserId(c);

  const challenge = await GamificationService.getWeeklyChallenge(userId);

  return c.json({ challenge });
});

/**
 * GET /activity-history - Alias for /activity/calendar
 * Query params: year (YYYY), month (1-12)
 */
gamification.get("/activity-history", async (c) => {
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

export default gamification;

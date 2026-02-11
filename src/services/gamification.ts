/**
 * Gamification Service
 * Comprehensive Duolingo-style gamification system
 * Handles XP, streaks, challenges, achievements, and activity tracking
 */

import { supabaseAdmin, isUserPro } from "./supabase.js";
import { sendPushNotification, isAPNsConfigured } from "./apns.js";

// XP amounts for different actions
export const XP_AMOUNTS = {
  VIEW_OUTFIT: 1,
  LIKE_OUTFIT: 2,
  REGENERATE: 2, // Pro only
  SAVE_OUTFIT: 3,
  ADD_ITEM: 5,
  WEAR_OUTFIT: 10,
  SHARE_OUTFIT: 15,
  VERIFY_OUTFIT: 15,
  DAILY_GOAL_BONUS: 5,
} as const;

// XP source types
export type XPSource =
  | "view_outfit"
  | "like_outfit"
  | "regenerate"
  | "save_outfit"
  | "add_item"
  | "wear_outfit"
  | "share_outfit"
  | "verify_outfit"
  | "daily_goal"
  | "challenge"
  | "achievement"
  | "streak_restore"
  | "evening_confirmation"
  | "evening_confirmation_alt";

// Type definitions
export interface XPAwardResult {
  success: boolean;
  new_total_xp: number;
  new_level: number;
  level_up: boolean;
  old_level: number;
  daily_goal_met: boolean;
  daily_xp: number;
  error?: string;
}

export interface StreakResult {
  success: boolean;
  current_streak: number;
  streak_maintained: boolean;
  freeze_used: boolean;
  streak_broken: boolean;
  freezes_remaining: number;
  streak_freeze_earned: boolean;
  longest_streak: number;
  error?: string;
}

export interface RestoreResult {
  success: boolean;
  new_streak: number;
  xp_cost: number;
  new_total_xp: number;
  error?: string;
}

export interface RepairResult {
  success: boolean;
  restored_streak: number;
  xp_spent: number;
  new_xp_total: number;
  error?: string;
}

export interface LevelInfo {
  level: number;
  title: string;
  min_xp: number;
  max_xp: number | null;
  badge_icon: string;
  color_hex: string;
}

export interface GamificationStats {
  total_xp: number;
  level: number;
  level_title: string;
  level_progress: number; // 0-100 percentage
  xp_to_next_level: number;
  current_streak: number;
  longest_streak: number;
  streak_freezes: number;
  max_streak_freezes: number;
  daily_xp_earned: number;
  daily_xp_goal: number;
  daily_goal_met: boolean;
  daily_goals_streak: number;
  total_outfits_worn: number;
  total_items_added: number;
  total_outfits_generated: number;
  is_pro: boolean;
  timezone: string; // User's timezone for streak calculations
}

export interface ChallengeProgress {
  id: string;
  challenge_id: string;
  name: string;
  description: string;
  challenge_type: string;
  progress: number;
  target: number;
  xp_reward: number;
  difficulty: string;
  icon: string;
  is_completed: boolean;
  is_claimed: boolean;
  completed_at: string | null;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  xp_reward: number;
  requirement_type: string;
  requirement_value: number;
  is_unlocked: boolean;
  unlocked_at: string | null;
  is_seen: boolean;
  progress?: number;
}

export interface ActivityDay {
  activity_date: string;
  xp_earned: number;
  outfits_worn: number;
  outfits_generated: number;
  items_added: number;
  streak_maintained: boolean;
  freeze_used: boolean;
  daily_goal_met: boolean;
  challenges_completed: number;
}

export interface XPTransaction {
  id: string;
  amount: number;
  source: string;
  description: string;
  created_at: string;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  total_xp: number;
  level: number;
  level_title: string;
}

/**
 * GamificationService - Main service class for all gamification operations
 */
export class GamificationService {
  /**
   * Award XP to a user
   * Uses the PostgreSQL award_xp function for atomic operations
   */
  static async awardXP(
    userId: string,
    amount: number,
    source: XPSource,
    sourceId?: string,
    description?: string
  ): Promise<XPAwardResult> {
    try {
      const { data, error } = await supabaseAdmin.rpc("award_xp", {
        p_user_id: userId,
        p_amount: amount,
        p_source: source,
        p_source_id: sourceId || null,
        p_description: description || null,
      });

      if (error) {
        console.error("[Gamification] Error awarding XP:", error);
        return {
          success: false,
          new_total_xp: 0,
          new_level: 1,
          level_up: false,
          old_level: 1,
          daily_goal_met: false,
          daily_xp: 0,
          error: error.message,
        };
      }

      console.log(`[XP] Awarded ${amount} XP to ${userId} | source=${source} | sourceId=${sourceId || 'none'} | total=${data.new_total_xp} | level=${data.new_level}${data.level_up ? ' LEVEL UP!' : ''}`);

      return {
        success: true,
        new_total_xp: data.new_total_xp,
        new_level: data.new_level,
        level_up: data.level_up,
        old_level: data.old_level,
        daily_goal_met: data.daily_goal_met,
        daily_xp: data.daily_xp,
      };
    } catch (err) {
      console.error("[Gamification] Exception awarding XP:", err);
      return {
        success: false,
        new_total_xp: 0,
        new_level: 1,
        level_up: false,
        old_level: 1,
        daily_goal_met: false,
        daily_xp: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  /**
   * Maintain user's streak (call when user wears an outfit)
   * Uses the PostgreSQL check_and_maintain_streak function
   */
  static async maintainStreak(userId: string): Promise<StreakResult> {
    try {
      const { data, error } = await supabaseAdmin.rpc(
        "check_and_maintain_streak",
        {
          p_user_id: userId,
          p_action: "wear",
        }
      );

      if (error) {
        console.error("[Gamification] Error maintaining streak:", error);
        return {
          success: false,
          current_streak: 0,
          streak_maintained: false,
          freeze_used: false,
          streak_broken: false,
          freezes_remaining: 0,
          streak_freeze_earned: false,
          longest_streak: 0,
          error: error.message,
        };
      }

      return {
        success: true,
        current_streak: data.current_streak,
        streak_maintained: data.streak_maintained,
        freeze_used: data.freeze_used,
        streak_broken: data.streak_broken,
        freezes_remaining: data.freezes_remaining,
        streak_freeze_earned: data.streak_freeze_earned,
        longest_streak: data.longest_streak,
      };
    } catch (err) {
      console.error("[Gamification] Exception maintaining streak:", err);
      return {
        success: false,
        current_streak: 0,
        streak_maintained: false,
        freeze_used: false,
        streak_broken: false,
        freezes_remaining: 0,
        streak_freeze_earned: false,
        longest_streak: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  /**
   * Check streak status without modifying it
   */
  static async checkStreak(userId: string): Promise<StreakResult> {
    try {
      const { data, error } = await supabaseAdmin.rpc(
        "check_and_maintain_streak",
        {
          p_user_id: userId,
          p_action: "check",
        }
      );

      if (error) {
        console.error("[Gamification] Error checking streak:", error);
        return {
          success: false,
          current_streak: 0,
          streak_maintained: false,
          freeze_used: false,
          streak_broken: false,
          freezes_remaining: 0,
          streak_freeze_earned: false,
          longest_streak: 0,
          error: error.message,
        };
      }

      return {
        success: true,
        current_streak: data.current_streak,
        streak_maintained: data.streak_maintained,
        freeze_used: data.freeze_used,
        streak_broken: data.streak_broken,
        freezes_remaining: data.freezes_remaining,
        streak_freeze_earned: data.streak_freeze_earned,
        longest_streak: data.longest_streak,
      };
    } catch (err) {
      console.error("[Gamification] Exception checking streak:", err);
      return {
        success: false,
        current_streak: 0,
        streak_maintained: false,
        freeze_used: false,
        streak_broken: false,
        freezes_remaining: 0,
        streak_freeze_earned: false,
        longest_streak: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  /**
   * Restore a lost streak (Pro only, costs 500 XP)
   */
  static async restoreStreak(userId: string): Promise<RestoreResult> {
    const XP_COST = 500;

    try {
      // Check if user is Pro
      const isPro = await isUserPro(userId);
      if (!isPro) {
        return {
          success: false,
          new_streak: 0,
          xp_cost: 0,
          new_total_xp: 0,
          error: "Streak restore is only available for Pro users",
        };
      }

      // Get current gamification state
      const { data: gamification, error: fetchError } = await supabaseAdmin
        .from("user_gamification")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (fetchError || !gamification) {
        return {
          success: false,
          new_streak: 0,
          xp_cost: 0,
          new_total_xp: 0,
          error: "User gamification not found",
        };
      }

      // Check if user has enough XP
      if (gamification.total_xp < XP_COST) {
        return {
          success: false,
          new_streak: 0,
          xp_cost: XP_COST,
          new_total_xp: gamification.total_xp,
          error: `Not enough XP. Need ${XP_COST}, have ${gamification.total_xp}`,
        };
      }

      // Check if streak was lost within 24 hours
      if (!gamification.streak_lost_at) {
        return {
          success: false,
          new_streak: 0,
          xp_cost: 0,
          new_total_xp: gamification.total_xp,
          error: "No streak to restore",
        };
      }

      const lostAt = new Date(gamification.streak_lost_at);
      const hoursAgo = (Date.now() - lostAt.getTime()) / (1000 * 60 * 60);
      if (hoursAgo > 24) {
        return {
          success: false,
          new_streak: 0,
          xp_cost: 0,
          new_total_xp: gamification.total_xp,
          error: "Streak can only be restored within 24 hours of losing it",
        };
      }

      // Get the streak value before it was lost (use streak_before_loss, not longest_streak)
      const previousStreak = gamification.streak_before_loss || gamification.longest_streak || 1;

      // Restore streak and deduct XP
      const { error: updateError } = await supabaseAdmin
        .from("user_gamification")
        .update({
          current_streak: previousStreak,
          total_xp: gamification.total_xp - XP_COST,
          streak_lost_at: null,
          last_streak_activity_date: new Date().toISOString().split("T")[0],
        })
        .eq("user_id", userId);

      if (updateError) {
        return {
          success: false,
          new_streak: 0,
          xp_cost: 0,
          new_total_xp: gamification.total_xp,
          error: updateError.message,
        };
      }

      // Log the XP transaction
      await supabaseAdmin.from("xp_transactions").insert({
        user_id: userId,
        amount: -XP_COST,
        source: "streak_restore",
        description: `Restored ${previousStreak}-day streak`,
      });

      return {
        success: true,
        new_streak: previousStreak,
        xp_cost: XP_COST,
        new_total_xp: gamification.total_xp - XP_COST,
      };
    } catch (err) {
      console.error("[Gamification] Exception restoring streak:", err);
      return {
        success: false,
        new_streak: 0,
        xp_cost: 0,
        new_total_xp: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  /**
   * Repair a lost streak (available to ALL users, costs 500 XP)
   * Unlike restoreStreak which is Pro-only, this is available to everyone
   */
  static async repairStreak(userId: string): Promise<RepairResult> {
    const XP_COST = 500;

    try {
      // Get current gamification state
      const { data: gamification, error: fetchError } = await supabaseAdmin
        .from("user_gamification")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (fetchError || !gamification) {
        return {
          success: false,
          restored_streak: 0,
          xp_spent: 0,
          new_xp_total: 0,
          error: "User gamification not found",
        };
      }

      // Check if there's a broken streak to repair
      if (!gamification.streak_lost_at) {
        return {
          success: false,
          restored_streak: 0,
          xp_spent: 0,
          new_xp_total: gamification.total_xp,
          error: "No broken streak to repair",
        };
      }

      // Check if streak was lost within 24 hours
      const lostAt = new Date(gamification.streak_lost_at);
      const hoursAgo = (Date.now() - lostAt.getTime()) / (1000 * 60 * 60);
      if (hoursAgo > 24) {
        return {
          success: false,
          restored_streak: 0,
          xp_spent: 0,
          new_xp_total: gamification.total_xp,
          error: "Repair window expired",
        };
      }

      // Check if already repaired this break (last_streak_repair_at >= streak_lost_at)
      if (gamification.last_streak_repair_at) {
        const lastRepairAt = new Date(gamification.last_streak_repair_at);
        if (lastRepairAt >= lostAt) {
          return {
            success: false,
            restored_streak: 0,
            xp_spent: 0,
            new_xp_total: gamification.total_xp,
            error: "Already repaired",
          };
        }
      }

      // Check if user has enough XP
      if (gamification.total_xp < XP_COST) {
        return {
          success: false,
          restored_streak: 0,
          xp_spent: 0,
          new_xp_total: gamification.total_xp,
          error: "Need 500 XP to repair",
        };
      }

      // Get the streak value before it was lost
      const previousStreak = gamification.streak_before_loss || 1;

      // Repair streak: restore value, deduct XP, set last_streak_repair_at
      const { error: updateError } = await supabaseAdmin
        .from("user_gamification")
        .update({
          current_streak: previousStreak,
          total_xp: gamification.total_xp - XP_COST,
          streak_lost_at: null,
          last_streak_repair_at: new Date().toISOString(),
          last_streak_activity_date: new Date().toISOString().split("T")[0],
        })
        .eq("user_id", userId);

      if (updateError) {
        return {
          success: false,
          restored_streak: 0,
          xp_spent: 0,
          new_xp_total: gamification.total_xp,
          error: updateError.message,
        };
      }

      // Log the XP transaction
      await supabaseAdmin.from("xp_transactions").insert({
        user_id: userId,
        amount: -XP_COST,
        source: "streak_restore",
        description: `Repaired ${previousStreak}-day streak`,
      });

      return {
        success: true,
        restored_streak: previousStreak,
        xp_spent: XP_COST,
        new_xp_total: gamification.total_xp - XP_COST,
      };
    } catch (err) {
      console.error("[Gamification] Exception repairing streak:", err);
      return {
        success: false,
        restored_streak: 0,
        xp_spent: 0,
        new_xp_total: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  /**
   * Get comprehensive gamification stats for a user
   */
  static async getStats(userId: string): Promise<GamificationStats | null> {
    try {
      // Fetch gamification data
      const { data: gamification, error: gamError } = await supabaseAdmin
        .from("user_gamification")
        .select("*")
        .eq("user_id", userId)
        .single();

      if (gamError && gamError.code !== "PGRST116") {
        console.error("[Gamification] Error fetching stats:", gamError);
        return null;
      }

      // Initialize if doesn't exist
      if (!gamification) {
        const { data: newGam, error: createError } = await supabaseAdmin
          .from("user_gamification")
          .insert({ user_id: userId })
          .select()
          .single();

        if (createError) {
          console.error(
            "[Gamification] Error creating gamification:",
            createError
          );
          return null;
        }

        return this.buildStats(newGam, userId);
      }

      return this.buildStats(gamification, userId);
    } catch (err) {
      console.error("[Gamification] Exception getting stats:", err);
      return null;
    }
  }

  /**
   * Build stats object from gamification data
   */
  private static async buildStats(
    gamification: Record<string, unknown>,
    userId: string
  ): Promise<GamificationStats> {
    // Use correct column names from database
    const currentLevel = (gamification.current_level as number) || 1;
    const streakFreezes = (gamification.streak_freezes_available as number) || 0;

    // Get level info
    const { data: levelInfo } = await supabaseAdmin
      .from("levels")
      .select("*")
      .eq("level", currentLevel)
      .single();

    // Get next level info for progress calculation
    const { data: nextLevelInfo } = await supabaseAdmin
      .from("levels")
      .select("*")
      .eq("level", currentLevel + 1)
      .single();

    const isPro = await isUserPro(userId);
    const maxFreezes = isPro ? 5 : 2;
    const dailyGoal = 50;

    // Calculate level progress
    let levelProgress = 100;
    let xpToNextLevel = 0;
    if (nextLevelInfo) {
      const currentLevelXp =
        (gamification.total_xp as number) - (levelInfo?.min_xp || 0);
      const levelRange = nextLevelInfo.min_xp - (levelInfo?.min_xp || 0);
      levelProgress = Math.min(
        100,
        Math.round((currentLevelXp / levelRange) * 100)
      );
      xpToNextLevel = nextLevelInfo.min_xp - (gamification.total_xp as number);
    }

    return {
      total_xp: (gamification.total_xp as number) || 0,
      level: currentLevel,
      level_title: levelInfo?.title || "Style Newbie",
      level_progress: levelProgress,
      xp_to_next_level: Math.max(0, xpToNextLevel),
      current_streak: (gamification.current_streak as number) || 0,
      longest_streak: (gamification.longest_streak as number) || 0,
      streak_freezes: streakFreezes,
      max_streak_freezes: maxFreezes,
      daily_xp_earned: (gamification.daily_xp_earned as number) || 0,
      daily_xp_goal: dailyGoal,
      daily_goal_met: ((gamification.daily_xp_earned as number) || 0) >= dailyGoal,
      daily_goals_streak: (gamification.daily_goals_streak as number) || 0,
      total_outfits_worn: (gamification.total_outfits_worn as number) || 0,
      total_items_added: (gamification.total_items_added as number) || 0,
      total_outfits_generated:
        (gamification.total_outfits_generated as number) || 0,
      is_pro: isPro,
      timezone: (gamification.timezone as string) || "America/Chicago",
    };
  }

  /**
   * Get all levels with titles
   */
  static async getLevels(): Promise<LevelInfo[]> {
    const { data, error } = await supabaseAdmin
      .from("levels")
      .select("*")
      .order("level", { ascending: true });

    if (error) {
      console.error("[Gamification] Error fetching levels:", error);
      return [];
    }

    return data || [];
  }

  /**
   * Get or generate daily challenges for a user
   */
  static async getDailyChallenges(
    userId: string
  ): Promise<ChallengeProgress[]> {
    try {
      // Call the generate function (returns existing if already generated)
      const { error } = await supabaseAdmin.rpc(
        "generate_daily_challenges",
        {
          p_user_id: userId,
        }
      );

      if (error) {
        console.error(
          "[Gamification] Error generating daily challenges:",
          error
        );
        return [];
      }

      // Fetch the challenges with details
      const today = new Date().toISOString().split("T")[0];
      const { data: challenges, error: fetchError } = await supabaseAdmin
        .from("user_daily_challenges")
        .select(
          `
          id,
          challenge_id,
          progress,
          target,
          xp_reward,
          is_completed,
          is_claimed,
          completed_at,
          daily_challenges (
            name,
            description,
            challenge_type,
            difficulty,
            icon
          )
        `
        )
        .eq("user_id", userId)
        .eq("challenge_date", today);

      if (fetchError) {
        console.error(
          "[Gamification] Error fetching daily challenges:",
          fetchError
        );
        return [];
      }

      return (challenges || []).map((c) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dc = c.daily_challenges as any;
        return {
          id: c.id,
          challenge_id: c.challenge_id,
          name: dc?.name || "",
          description: dc?.description || "",
          challenge_type: dc?.challenge_type || "",
          progress: c.progress,
          target: c.target,
          xp_reward: c.xp_reward,
          difficulty: dc?.difficulty || "",
          icon: dc?.icon || "",
          is_completed: c.is_completed,
          is_claimed: c.is_claimed,
          completed_at: c.completed_at,
        };
      });
    } catch (err) {
      console.error("[Gamification] Exception getting daily challenges:", err);
      return [];
    }
  }

  /**
   * Get or generate weekly challenge for a user
   */
  static async getWeeklyChallenge(
    userId: string
  ): Promise<ChallengeProgress | null> {
    try {
      // Call the generate function (returns existing if already generated)
      const { error } = await supabaseAdmin.rpc("generate_weekly_challenge", {
        p_user_id: userId,
      });

      if (error) {
        console.error(
          "[Gamification] Error generating weekly challenge:",
          error
        );
        return null;
      }

      // Get current week start (Monday)
      const now = new Date();
      const dayOfWeek = now.getDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - diff);
      weekStart.setHours(0, 0, 0, 0);
      const weekStartStr = weekStart.toISOString().split("T")[0];

      // Fetch the challenge with details
      const { data: challenge, error: fetchError } = await supabaseAdmin
        .from("user_weekly_challenges")
        .select(
          `
          id,
          challenge_id,
          progress,
          target,
          xp_reward,
          is_completed,
          is_claimed,
          completed_at,
          weekly_challenges (
            name,
            description,
            challenge_type,
            icon
          )
        `
        )
        .eq("user_id", userId)
        .eq("week_start", weekStartStr)
        .single();

      if (fetchError && fetchError.code !== "PGRST116") {
        console.error(
          "[Gamification] Error fetching weekly challenge:",
          fetchError
        );
        return null;
      }

      if (!challenge) return null;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wc = challenge.weekly_challenges as any;
      return {
        id: challenge.id,
        challenge_id: challenge.challenge_id,
        name: wc?.name || "",
        description: wc?.description || "",
        challenge_type: wc?.challenge_type || "",
        progress: challenge.progress,
        target: challenge.target,
        xp_reward: challenge.xp_reward,
        difficulty: "weekly", // Weekly challenges don't have difficulty, set default
        icon: wc?.icon || "",
        is_completed: challenge.is_completed,
        is_claimed: challenge.is_claimed,
        completed_at: challenge.completed_at,
      };
    } catch (err) {
      console.error("[Gamification] Exception getting weekly challenge:", err);
      return null;
    }
  }

  /**
   * Update challenge progress
   */
  static async updateChallengeProgress(
    userId: string,
    challengeType: string,
    increment: number = 1,
    value?: number
  ): Promise<void> {
    try {
      await supabaseAdmin.rpc("update_challenge_progress", {
        p_user_id: userId,
        p_challenge_type: challengeType,
        p_increment: increment,
        p_value: value || null,
      });
    } catch (err) {
      console.error(
        "[Gamification] Exception updating challenge progress:",
        err
      );
    }
  }

  /**
   * Claim a completed challenge
   */
  static async claimChallenge(
    userId: string,
    challengeId: string,
    isWeekly: boolean = false
  ): Promise<XPAwardResult> {
    try {
      const table = isWeekly ? "user_weekly_challenges" : "user_daily_challenges";

      // Get the challenge
      const { data: challenge, error: fetchError } = await supabaseAdmin
        .from(table)
        .select("*")
        .eq("id", challengeId)
        .eq("user_id", userId)
        .single();

      if (fetchError || !challenge) {
        return {
          success: false,
          new_total_xp: 0,
          new_level: 1,
          level_up: false,
          old_level: 1,
          daily_goal_met: false,
          daily_xp: 0,
          error: "Challenge not found",
        };
      }

      if (!challenge.is_completed) {
        return {
          success: false,
          new_total_xp: 0,
          new_level: 1,
          level_up: false,
          old_level: 1,
          daily_goal_met: false,
          daily_xp: 0,
          error: "Challenge not completed",
        };
      }

      if (challenge.is_claimed) {
        return {
          success: false,
          new_total_xp: 0,
          new_level: 1,
          level_up: false,
          old_level: 1,
          daily_goal_met: false,
          daily_xp: 0,
          error: "Challenge already claimed",
        };
      }

      // Mark as claimed
      await supabaseAdmin
        .from(table)
        .update({
          is_claimed: true,
          claimed_at: new Date().toISOString(),
        })
        .eq("id", challengeId);

      // Award XP
      return this.awardXP(
        userId,
        challenge.xp_reward,
        "challenge",
        challengeId,
        `${isWeekly ? "Weekly" : "Daily"} challenge completed`
      );
    } catch (err) {
      console.error("[Gamification] Exception claiming challenge:", err);
      return {
        success: false,
        new_total_xp: 0,
        new_level: 1,
        level_up: false,
        old_level: 1,
        daily_goal_met: false,
        daily_xp: 0,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  /**
   * Get all achievements for a user
   */
  static async getAchievements(userId: string): Promise<Achievement[]> {
    try {
      // Get all achievements
      const { data: allAchievements, error: achError } = await supabaseAdmin
        .from("achievements")
        .select("*")
        .order("category")
        .order("requirement_value");

      if (achError) {
        console.error("[Gamification] Error fetching achievements:", achError);
        return [];
      }

      // Get user's unlocked achievements
      const { data: userAchievements, error: userAchError } = await supabaseAdmin
        .from("user_achievements")
        .select("*")
        .eq("user_id", userId);

      if (userAchError) {
        console.error(
          "[Gamification] Error fetching user achievements:",
          userAchError
        );
      }

      const unlockedMap = new Map(
        (userAchievements || []).map((ua) => [
          ua.achievement_id,
          { unlocked_at: ua.unlocked_at, is_seen: ua.is_seen ?? (ua.seen_at !== null) },
        ])
      );

      // Get progress data for computing achievement progress
      const { data: gamification } = await supabaseAdmin
        .from("user_gamification")
        .select("*")
        .eq("user_id", userId)
        .single();

      const { count: itemCount } = await supabaseAdmin
        .from("wardrobe_items")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_archived", false);

      const { count: outfitCount } = await supabaseAdmin
        .from("outfit_history")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);

      const { count: verifiedCount } = await supabaseAdmin
        .from("outfit_history")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .not("photo_url", "is", null);

      // Get distinct category count
      const { data: categoryData } = await supabaseAdmin
        .from("wardrobe_items")
        .select("category")
        .eq("user_id", userId)
        .eq("is_archived", false)
        .not("category", "is", null);
      const categoryCount = new Set((categoryData || []).map((i) => i.category)).size;

      // Get distinct seasons count (from array field)
      const { data: seasonData } = await supabaseAdmin
        .from("wardrobe_items")
        .select("seasons")
        .eq("user_id", userId)
        .eq("is_archived", false);
      const allSeasons = new Set<string>();
      (seasonData || []).forEach((item) => {
        if (Array.isArray(item.seasons)) {
          item.seasons.forEach((s: string) => allSeasons.add(s));
        }
      });
      const seasonCount = allSeasons.size;

      // Get distinct primary colors count
      const { data: colorData } = await supabaseAdmin
        .from("wardrobe_items")
        .select("colors")
        .eq("user_id", userId)
        .eq("is_archived", false);
      const primaryColors = new Set<string>();
      (colorData || []).forEach((item) => {
        const colors = item.colors as { primary?: string } | null;
        if (colors?.primary) {
          primaryColors.add(colors.primary);
        }
      });
      const colorCount = primaryColors.size;

      // Get max style score (as percentage)
      const { data: styleScoreData } = await supabaseAdmin
        .from("outfit_history")
        .select("outfit_id, generated_outfits(style_score)")
        .eq("user_id", userId);
      let maxStyleScore = 0;
      (styleScoreData || []).forEach((oh) => {
        const outfit = oh.generated_outfits as { style_score?: number } | null;
        if (outfit?.style_score) {
          const scorePercent = Math.round(outfit.style_score * 100);
          if (scorePercent > maxStyleScore) {
            maxStyleScore = scorePercent;
          }
        }
      });

      // Process achievements and unlock any newly completed ones
      const achievements: Achievement[] = [];
      const newlyUnlocked: string[] = [];

      for (const a of allAchievements || []) {
        const existingUnlock = unlockedMap.get(a.id);
        let progress = 0;

        // Calculate progress based on requirement type
        switch (a.requirement_type) {
          case "items_uploaded":
            progress = itemCount || 0;
            break;
          case "outfits_worn":
            progress = outfitCount || 0;
            break;
          case "streak_days":
            progress = gamification?.longest_streak || 0;
            break;
          case "total_xp":
            progress = gamification?.total_xp || 0;
            break;
          case "verified_outfits":
            progress = verifiedCount || 0;
            break;
          case "categories_owned":
            progress = categoryCount;
            break;
          case "seasons_covered":
            progress = seasonCount;
            break;
          case "colors_owned":
            progress = colorCount;
            break;
          case "outfits_shared":
            progress = (gamification?.total_outfits_shared as number) || 0;
            break;
          case "max_style_score":
            progress = maxStyleScore;
            break;
          case "daily_goals_streak":
            progress = gamification?.daily_goals_streak || 0;
            break;
          default:
            progress = 0;
        }

        const isCompleted = progress >= a.requirement_value;
        const wasAlreadyUnlocked = !!existingUnlock?.unlocked_at;

        // If newly completed, mark as unlocked (but do NOT award XP here —
        // XP is only awarded via checkAndUnlockAchievements() after actions)
        if (isCompleted && !wasAlreadyUnlocked) {
          newlyUnlocked.push(a.id);
          await supabaseAdmin.from("user_achievements").upsert(
            {
              user_id: userId,
              achievement_id: a.id,
              unlocked_at: new Date().toISOString(),
              is_unlocked: true,
              is_seen: false,
            },
            { onConflict: "user_id,achievement_id" }
          );
        }

        achievements.push({
          id: a.id,
          name: a.name,
          description: a.description,
          category: a.category,
          icon: a.icon,
          xp_reward: a.xp_reward,
          requirement_type: a.requirement_type,
          requirement_value: a.requirement_value,
          is_unlocked: isCompleted || wasAlreadyUnlocked,
          unlocked_at: existingUnlock?.unlocked_at || (isCompleted ? new Date().toISOString() : null),
          is_seen: wasAlreadyUnlocked ? (existingUnlock?.is_seen ?? true) : false,
          progress: Math.min(progress, a.requirement_value),
        });
      }

      if (newlyUnlocked.length > 0) {
        console.log(`[Gamification] Unlocked ${newlyUnlocked.length} achievements for user ${userId}:`, newlyUnlocked);
      }

      return achievements;
    } catch (err) {
      console.error("[Gamification] Exception getting achievements:", err);
      return [];
    }
  }

  /**
   * Check and unlock any newly earned achievements
   */
  static async checkAndUnlockAchievements(
    userId: string
  ): Promise<Achievement[]> {
    try {
      const { data, error } = await supabaseAdmin.rpc("check_achievements", {
        p_user_id: userId,
      });

      if (error) {
        console.error("[Gamification] Error checking achievements:", error);
        return [];
      }

      const newAchievements: Achievement[] = [];

      // Unlock each new achievement
      for (const row of data || []) {
        const achId = row.achievement_id;
        // Get achievement details
        const { data: achievement } = await supabaseAdmin
          .from("achievements")
          .select("*")
          .eq("id", achId)
          .single();

        if (achievement) {
          // Check if not already unlocked
          const { data: existing } = await supabaseAdmin
            .from("user_achievements")
            .select("id")
            .eq("user_id", userId)
            .eq("achievement_id", achId)
            .single();

          if (!existing) {
            // Unlock achievement
            await supabaseAdmin.from("user_achievements").insert({
              user_id: userId,
              achievement_id: achId,
              unlocked_at: new Date().toISOString(),
              is_unlocked: true,
              is_seen: false,
            });

            // Award XP
            await this.awardXP(
              userId,
              achievement.xp_reward,
              "achievement",
              undefined, // source_id is nullable, description has context
              `Achievement unlocked: ${achievement.name}`
            );

            newAchievements.push({
              id: achievement.id,
              name: achievement.name,
              description: achievement.description,
              category: achievement.category,
              icon: achievement.icon,
              xp_reward: achievement.xp_reward,
              requirement_type: achievement.requirement_type,
              requirement_value: achievement.requirement_value,
              is_unlocked: true,
              unlocked_at: new Date().toISOString(),
              is_seen: false,
            });
          }
        }
      }

      // Send push notifications for newly unlocked achievements
      if (newAchievements.length > 0 && isAPNsConfigured()) {
        // Get user's push settings
        const { data: profile } = await supabaseAdmin
          .from("user_profiles")
          .select("push_token, push_enabled")
          .eq("id", userId)
          .single();

        if (profile?.push_enabled && profile?.push_token) {
          for (const achievement of newAchievements) {
            try {
              await sendPushNotification(profile.push_token, {
                title: "🏆 Achievement Unlocked!",
                body: achievement.name,
                data: {
                  type: "badge_unlock",
                  screen: "achieve",
                  badge_id: achievement.id,
                },
              });
              console.log(
                `[Gamification] Sent badge unlock push for ${achievement.id}`
              );
            } catch (pushError) {
              // Don't break achievement flow if push fails
              console.error(`[Gamification] Badge push failed:`, pushError);
            }
          }
        }
      }

      return newAchievements;
    } catch (err) {
      console.error(
        "[Gamification] Exception checking achievements:",
        err
      );
      return [];
    }
  }

  /**
   * Mark an achievement as seen
   */
  static async markAchievementSeen(
    userId: string,
    achievementId: string
  ): Promise<boolean> {
    try {
      const { error } = await supabaseAdmin
        .from("user_achievements")
        .update({ seen_at: new Date().toISOString(), is_seen: true })
        .eq("user_id", userId)
        .eq("achievement_id", achievementId);

      return !error;
    } catch {
      return false;
    }
  }

  /**
   * Get activity calendar for a month
   */
  static async getActivityCalendar(
    userId: string,
    year: number,
    month: number
  ): Promise<ActivityDay[]> {
    try {
      const startDate = new Date(year, month - 1, 1)
        .toISOString()
        .split("T")[0];
      const endDate = new Date(year, month, 0).toISOString().split("T")[0];

      const { data, error } = await supabaseAdmin
        .from("daily_activity")
        .select("*")
        .eq("user_id", userId)
        .gte("activity_date", startDate)
        .lte("activity_date", endDate)
        .order("activity_date");

      if (error) {
        console.error("[Gamification] Error fetching activity calendar:", error);
        return [];
      }

      return data || [];
    } catch (err) {
      console.error("[Gamification] Exception getting activity calendar:", err);
      return [];
    }
  }

  /**
   * Get activity for the last N days (for iOS compatibility)
   */
  static async getActivityByDays(
    userId: string,
    days: number
  ): Promise<ActivityDay[]> {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days + 1);

      const startDateStr = startDate.toISOString().split("T")[0];
      const endDateStr = endDate.toISOString().split("T")[0];

      const { data, error } = await supabaseAdmin
        .from("daily_activity")
        .select("*")
        .eq("user_id", userId)
        .gte("activity_date", startDateStr)
        .lte("activity_date", endDateStr)
        .order("activity_date", { ascending: false });

      if (error) {
        console.error("[Gamification] Error fetching activity by days:", error);
        return [];
      }

      return data || [];
    } catch (err) {
      console.error("[Gamification] Exception getting activity by days:", err);
      return [];
    }
  }

  /**
   * Get XP transaction history
   */
  static async getXPHistory(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<XPTransaction[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from("xp_transactions")
        .select("id, amount, source, description, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error("[Gamification] Error fetching XP history:", error);
        return [];
      }

      return data || [];
    } catch (err) {
      console.error("[Gamification] Exception getting XP history:", err);
      return [];
    }
  }

  /**
   * Get leaderboard (top users by XP)
   */
  static async getLeaderboard(limit: number = 50): Promise<LeaderboardEntry[]> {
    try {
      const { data, error } = await supabaseAdmin
        .from("user_gamification")
        .select(
          `
          user_id,
          total_xp,
          level,
          user_profiles (
            display_name,
            avatar_url
          )
        `
        )
        .order("total_xp", { ascending: false })
        .limit(limit);

      if (error) {
        console.error("[Gamification] Error fetching leaderboard:", error);
        return [];
      }

      // Get level titles
      const { data: levels } = await supabaseAdmin
        .from("levels")
        .select("level, title");

      const levelTitles = new Map(
        (levels || []).map((l) => [l.level, l.title])
      );

      return (data || []).map((entry, index) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const profile = entry.user_profiles as any;
        return {
          rank: index + 1,
          user_id: entry.user_id,
          display_name: profile?.display_name || null,
          avatar_url: profile?.avatar_url || null,
          total_xp: entry.total_xp,
          level: entry.level,
          level_title: levelTitles.get(entry.level) || "Style Newbie",
        };
      });
    } catch (err) {
      console.error("[Gamification] Exception getting leaderboard:", err);
      return [];
    }
  }

  /**
   * Increment a user stat (outfits worn, items added, etc.)
   */
  static async incrementStat(
    userId: string,
    stat: "total_outfits_worn" | "total_items_added" | "total_outfits_generated" | "total_outfits_shared",
    amount: number = 1
  ): Promise<void> {
    try {
      // Ensure user_gamification exists
      await supabaseAdmin
        .from("user_gamification")
        .upsert({ user_id: userId }, { onConflict: "user_id" });

      // Increment the stat
      await supabaseAdmin.rpc("increment", {
        row_id: userId,
        table_name: "user_gamification",
        column_name: stat,
        increment_by: amount,
      });
    } catch (err) {
      console.error(`[Gamification] Error incrementing ${stat}:`, err);
    }
  }
}

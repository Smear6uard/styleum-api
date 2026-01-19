/**
 * Vouch Push Notification Service
 *
 * Handles all push notification types for the Vouch social layer:
 * - Vote notifications (rate limited)
 * - Milestone celebrations
 * - Tier promotions/demotions
 * - Weekly summaries and resets
 * - Streak milestones
 */

import { sendPushNotification } from "./apns.js";
import { supabaseAdmin } from "./supabase.js";

// =============================================================================
// TYPES
// =============================================================================

export enum NotificationType {
  VOTE_RECEIVED = "vote_received",
  VOTE_MILESTONE = "vote_milestone",
  TIER_PROMOTION = "tier_promotion",
  TIER_DEMOTION = "tier_demotion",
  WEEKLY_RESET = "weekly_reset",
  WEEKLY_SUMMARY = "weekly_summary",
  STREAK_MILESTONE = "streak_milestone",
  STREAK_AT_RISK = "streak_at_risk",
}

interface NotificationTemplate {
  title: string;
  body: string;
}

// =============================================================================
// NOTIFICATION TEMPLATES
// =============================================================================

const NOTIFICATION_TEMPLATES: Record<string, NotificationTemplate> = {
  // Vote notifications
  vote_received: {
    title: "New Vote! 🔥",
    body: "{voterName} vouched for your fit",
  },
  vote_milestone_5: {
    title: "5 Votes! 🎯",
    body: "Your outfit just hit 5 vouches",
  },
  vote_milestone_10: {
    title: "10 Votes! ⚡",
    body: "You're on fire - 10 vouches and counting",
  },
  vote_milestone_25: {
    title: "25 Votes! 🌟",
    body: "Your fit is trending with 25 vouches",
  },
  vote_milestone_50: {
    title: "50 Votes! 💎",
    body: "Major milestone - 50 vouches on your outfit",
  },
  vote_milestone_100: {
    title: "100 Votes! 👑",
    body: "Legendary status - 100 vouches!",
  },

  // Tier changes
  tier_promotion: {
    title: "Tier Up! 🚀",
    body: "You've been promoted to {tier}",
  },
  tier_demotion: {
    title: "Tier Change",
    body: "You've moved to {tier} tier",
  },

  // Weekly notifications
  weekly_reset: {
    title: "New Week Begins! 🏆",
    body: "Leaderboards have reset. Time to compete!",
  },
  weekly_summary_active: {
    title: "Weekly Recap 📊",
    body: "You earned {votes} votes and finished #{rank} in {tier}",
  },
  weekly_summary_inactive: {
    title: "We Missed You! 👋",
    body: "The competition was fierce this week. Jump back in!",
  },

  // Streak notifications
  streak_milestone_7: {
    title: "7-Day Streak! 🔥",
    body: "One week strong - keep the momentum going",
  },
  streak_milestone_14: {
    title: "14-Day Streak! ⚡",
    body: "Two weeks of consistency - you're unstoppable",
  },
  streak_milestone_30: {
    title: "30-Day Streak! 💎",
    body: "A full month of style - legendary commitment",
  },
  streak_milestone_60: {
    title: "60-Day Streak! 👑",
    body: "Two months strong - you're a true style icon",
  },
  streak_milestone_90: {
    title: "90-Day Streak! 🏆",
    body: "Three months of daily style - absolutely elite",
  },
};

// Tier display names (capitalized)
const TIER_DISPLAY_NAMES: Record<string, string> = {
  rookie: "Rookie",
  seeker: "Seeker",
  builder: "Builder",
  maven: "Maven",
  icon: "Icon",
  legend: "Legend",
};

// Vote milestone thresholds
const VOTE_MILESTONES = [5, 10, 25, 50, 100];

// Streak milestone thresholds
const STREAK_MILESTONES = [7, 14, 30, 60, 90];

// =============================================================================
// RATE LIMITING
// =============================================================================

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory rate limit store for vote notifications
// Note: This won't work across multiple instances - consider Redis for production
const voteNotificationLimits = new Map<string, RateLimitEntry>();

const VOTE_NOTIFICATION_MAX_PER_DAY = 5;
const VOTE_NOTIFICATION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check and update rate limit for vote notifications
 * Returns true if notification should be sent, false if rate limited
 */
function checkVoteNotificationRateLimit(userId: string): boolean {
  const now = Date.now();
  let entry = voteNotificationLimits.get(userId);

  // Reset if window has passed
  if (!entry || entry.resetTime < now) {
    entry = {
      count: 0,
      resetTime: now + VOTE_NOTIFICATION_WINDOW_MS,
    };
  }

  // Check if limit exceeded
  if (entry.count >= VOTE_NOTIFICATION_MAX_PER_DAY) {
    return false;
  }

  // Increment and save
  entry.count++;
  voteNotificationLimits.set(userId, entry);

  return true;
}

// Clean up expired rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of voteNotificationLimits.entries()) {
    if (entry.resetTime < now) {
      voteNotificationLimits.delete(key);
    }
  }
}, 60000); // Clean every minute

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get a user's push token if push notifications are enabled
 */
async function getUserPushToken(
  userId: string
): Promise<{ token: string; firstName: string | null } | null> {
  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .select("push_token, push_enabled, first_name")
    .eq("id", userId)
    .single();

  if (error || !data) {
    console.log(`[Vouch Notifications] User ${userId} not found`);
    return null;
  }

  if (!data.push_enabled || !data.push_token) {
    console.log(`[Vouch Notifications] User ${userId} has push disabled`);
    return null;
  }

  return {
    token: data.push_token,
    firstName: data.first_name,
  };
}

/**
 * Get a user's display name for notification text
 */
async function getUserDisplayName(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .select("display_name, first_name")
    .eq("id", userId)
    .single();

  if (error || !data) {
    return "Someone";
  }

  return data.display_name || data.first_name || "Someone";
}

/**
 * Replace template placeholders with actual values
 */
function formatTemplate(
  template: NotificationTemplate,
  replacements: Record<string, string>
): NotificationTemplate {
  let title = template.title;
  let body = template.body;

  for (const [key, value] of Object.entries(replacements)) {
    title = title.replace(new RegExp(`\\{${key}\\}`, "g"), value);
    body = body.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }

  return { title, body };
}

// =============================================================================
// NOTIFICATION FUNCTIONS
// =============================================================================

/**
 * Send notification when a user receives a vote on their outfit
 * Rate limited to 5 notifications per day per recipient
 */
export async function notifyVoteReceived(
  recipientId: string,
  voterId: string,
  outfitId: string
): Promise<void> {
  try {
    // Check rate limit first
    if (!checkVoteNotificationRateLimit(recipientId)) {
      console.log(
        `[Vouch Notifications] Rate limited: ${recipientId} (vote notification)`
      );
      return;
    }

    // Get recipient's push token
    const recipient = await getUserPushToken(recipientId);
    if (!recipient) return;

    // Get voter's display name
    const voterName = await getUserDisplayName(voterId);

    // Format and send notification
    const template = formatTemplate(NOTIFICATION_TEMPLATES.vote_received, {
      voterName,
    });

    await sendPushNotification(recipient.token, {
      title: template.title,
      body: template.body,
      data: {
        type: NotificationType.VOTE_RECEIVED,
        screen: "feed",
        outfitId,
      },
    });

    console.log(
      `[Vouch Notifications] Vote notification sent to ${recipientId}`
    );
  } catch (error) {
    console.error("[Vouch Notifications] Error sending vote notification:", error);
  }
}

/**
 * Check if a vote count has crossed a milestone and send notification
 * Should be called after incrementing vote count
 */
export async function checkVoteMilestone(
  userId: string,
  outfitId: string,
  newVoteCount: number
): Promise<void> {
  try {
    // Check if we've hit a milestone
    if (!VOTE_MILESTONES.includes(newVoteCount)) {
      return;
    }

    // Get user's push token
    const user = await getUserPushToken(userId);
    if (!user) return;

    // Get the appropriate template
    const templateKey = `vote_milestone_${newVoteCount}`;
    const template = NOTIFICATION_TEMPLATES[templateKey];

    if (!template) {
      console.error(`[Vouch Notifications] No template for milestone: ${newVoteCount}`);
      return;
    }

    await sendPushNotification(user.token, {
      title: template.title,
      body: template.body,
      data: {
        type: NotificationType.VOTE_MILESTONE,
        screen: "feed",
        outfitId,
      },
    });

    console.log(
      `[Vouch Notifications] Milestone (${newVoteCount}) notification sent to ${userId}`
    );
  } catch (error) {
    console.error("[Vouch Notifications] Error sending milestone notification:", error);
  }
}

/**
 * Send notification when a user's tier changes
 */
export async function notifyTierChange(
  userId: string,
  newTier: string,
  direction: "promotion" | "demotion"
): Promise<void> {
  try {
    // Get user's push token
    const user = await getUserPushToken(userId);
    if (!user) return;

    const templateKey = direction === "promotion" ? "tier_promotion" : "tier_demotion";
    const tierDisplayName = TIER_DISPLAY_NAMES[newTier] || newTier;

    const template = formatTemplate(NOTIFICATION_TEMPLATES[templateKey], {
      tier: tierDisplayName,
    });

    await sendPushNotification(user.token, {
      title: template.title,
      body: template.body,
      data: {
        type:
          direction === "promotion"
            ? NotificationType.TIER_PROMOTION
            : NotificationType.TIER_DEMOTION,
        screen: "leaderboard",
        tier: newTier,
      },
    });

    console.log(
      `[Vouch Notifications] Tier ${direction} (${newTier}) notification sent to ${userId}`
    );
  } catch (error) {
    console.error("[Vouch Notifications] Error sending tier change notification:", error);
  }
}

/**
 * Send weekly reset notification to all users in a school
 */
export async function notifyWeeklyReset(schoolId: string): Promise<void> {
  try {
    // Get all users in the school with push enabled
    const { data: users, error } = await supabaseAdmin
      .from("user_profiles")
      .select("id, push_token")
      .eq("school_id", schoolId)
      .eq("push_enabled", true)
      .not("push_token", "is", null);

    if (error) {
      console.error("[Vouch Notifications] Error fetching school users:", error);
      return;
    }

    if (!users || users.length === 0) {
      console.log(`[Vouch Notifications] No users to notify for school ${schoolId}`);
      return;
    }

    const template = NOTIFICATION_TEMPLATES.weekly_reset;

    // Send to all users (fire and forget)
    const notifications = users.map((user) =>
      sendPushNotification(user.push_token!, {
        title: template.title,
        body: template.body,
        data: {
          type: NotificationType.WEEKLY_RESET,
          screen: "leaderboard",
        },
      })
    );

    await Promise.allSettled(notifications);

    console.log(
      `[Vouch Notifications] Weekly reset notifications sent to ${users.length} users in school ${schoolId}`
    );
  } catch (error) {
    console.error("[Vouch Notifications] Error sending weekly reset notifications:", error);
  }
}

/**
 * Send weekly summary notification to a user
 */
export async function notifyWeeklySummary(
  userId: string,
  votes: number,
  rank: number,
  tier: string,
  wasActive: boolean
): Promise<void> {
  try {
    // Get user's push token
    const user = await getUserPushToken(userId);
    if (!user) return;

    const tierDisplayName = TIER_DISPLAY_NAMES[tier] || tier;

    if (wasActive) {
      const template = formatTemplate(NOTIFICATION_TEMPLATES.weekly_summary_active, {
        votes: votes.toString(),
        rank: rank.toString(),
        tier: tierDisplayName,
      });

      await sendPushNotification(user.token, {
        title: template.title,
        body: template.body,
        data: {
          type: NotificationType.WEEKLY_SUMMARY,
          screen: "leaderboard",
          tier,
        },
      });
    } else {
      const template = NOTIFICATION_TEMPLATES.weekly_summary_inactive;

      await sendPushNotification(user.token, {
        title: template.title,
        body: template.body,
        data: {
          type: NotificationType.WEEKLY_SUMMARY,
          screen: "leaderboard",
        },
      });
    }

    console.log(`[Vouch Notifications] Weekly summary sent to ${userId}`);
  } catch (error) {
    console.error("[Vouch Notifications] Error sending weekly summary:", error);
  }
}

/**
 * Send notification for streak milestones
 */
export async function notifyStreakMilestone(
  userId: string,
  days: number
): Promise<void> {
  try {
    // Only notify for specific milestones
    if (!STREAK_MILESTONES.includes(days)) {
      return;
    }

    // Get user's push token
    const user = await getUserPushToken(userId);
    if (!user) return;

    const templateKey = `streak_milestone_${days}`;
    const template = NOTIFICATION_TEMPLATES[templateKey];

    if (!template) {
      console.error(`[Vouch Notifications] No template for streak milestone: ${days}`);
      return;
    }

    await sendPushNotification(user.token, {
      title: template.title,
      body: template.body,
      data: {
        type: NotificationType.STREAK_MILESTONE,
        screen: "profile",
      },
    });

    console.log(
      `[Vouch Notifications] Streak milestone (${days} days) notification sent to ${userId}`
    );
  } catch (error) {
    console.error("[Vouch Notifications] Error sending streak milestone notification:", error);
  }
}

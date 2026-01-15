import { supabaseAdmin } from "../services/supabase.js";
import { sendPushNotification, isAPNsConfigured } from "../services/apns.js";

interface StreakAtRiskUser {
  id: string;
  push_token: string | null;
  current_streak: number;
}

interface StreakAtRiskResult {
  success: boolean;
  notified: number;
  failed: number;
  skipped: number;
  errors: string[];
  duration_ms: number;
}

/**
 * Sends "streak at risk" push notifications to users who:
 * - Have push notifications enabled with a valid token
 * - Have a current streak > 0
 * - Haven't logged any streak activity today
 * - Are currently at 6 PM local time (18:00)
 *
 * Runs hourly to catch users in different timezones.
 */
export async function sendStreakAtRiskNotifications(): Promise<StreakAtRiskResult> {
  const startTime = Date.now();
  const result: StreakAtRiskResult = {
    success: true,
    notified: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    duration_ms: 0,
  };

  // Check if APNs is configured
  if (!isAPNsConfigured()) {
    console.log("[StreakAtRisk] APNs not configured, skipping");
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  const currentHour = new Date().getUTCHours();
  console.log(`[StreakAtRisk] Running for UTC hour ${currentHour}`);

  // Query users who need streak warning at 6 PM local time
  const { data: users, error } = await supabaseAdmin.rpc(
    "get_users_for_streak_warning",
    { current_utc_hour: currentHour }
  );

  if (error) {
    console.error("[StreakAtRisk] Failed to fetch users:", error);
    result.success = false;
    result.errors.push(error.message);
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  const typedUsers = users as StreakAtRiskUser[] | null;
  console.log(`[StreakAtRisk] Found ${typedUsers?.length || 0} users at risk`);

  for (const user of typedUsers || []) {
    if (!user.push_token) {
      result.skipped++;
      continue;
    }

    const payload = {
      title: "🔥 Your streak is at risk!",
      body: `You haven't styled today. Don't lose your ${user.current_streak}-day streak!`,
      data: { type: "streak_warning", screen: "style_me" },
    };

    const sent = await sendPushNotification(user.push_token, payload);
    if (sent) {
      result.notified++;
      console.log(`[StreakAtRisk] Notified user ${user.id}`);
    } else {
      result.failed++;
      result.errors.push(`Failed for user ${user.id}`);
    }

    // Rate limit: 50ms delay between notifications
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  result.duration_ms = Date.now() - startTime;
  console.log(
    `[StreakAtRisk] Complete: ${result.notified} notified, ${result.failed} failed, ${result.skipped} skipped`
  );
  return result;
}

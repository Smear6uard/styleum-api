import { supabaseAdmin } from "../services/supabase.js";
import { sendPushNotification, isAPNsConfigured } from "../services/apns.js";

interface EveningConfirmationUser {
  user_id: string;
  push_token: string | null;
  current_streak: number;
  timezone: string;
  first_name: string | null;
}

interface EveningConfirmationResult {
  success: boolean;
  notified: number;
  failed: number;
  skipped: number;
  errors: string[];
  duration_ms: number;
}

/**
 * Sends evening confirmation push notifications to users who:
 * - Have push notifications enabled with a valid token
 * - Have evening confirmation enabled
 * - Haven't confirmed/maintained their streak today
 * - Are currently at their preferred evening notification time (default 8 PM)
 *
 * Runs hourly to catch users in different timezones.
 * Users tap notification to confirm: "Yes I wore it" / "Something else" / "Skip"
 */
export async function sendEveningConfirmations(): Promise<EveningConfirmationResult> {
  const startTime = Date.now();
  const result: EveningConfirmationResult = {
    success: true,
    notified: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    duration_ms: 0,
  };

  // Check if APNs is configured
  if (!isAPNsConfigured()) {
    console.log("[EveningConfirmation] APNs not configured, skipping");
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  const currentHour = new Date().getUTCHours();
  console.log(`[EveningConfirmation] Running for UTC hour ${currentHour}`);

  // Query users who need evening confirmation at their preferred local time
  const { data: users, error } = await supabaseAdmin.rpc(
    "get_users_for_evening_confirmation",
    { current_utc_hour: currentHour }
  );

  if (error) {
    console.error("[EveningConfirmation] Failed to fetch users:", error);
    result.success = false;
    result.errors.push(error.message);
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  const typedUsers = users as EveningConfirmationUser[] | null;
  console.log(`[EveningConfirmation] Found ${typedUsers?.length || 0} users to notify`);

  for (const user of typedUsers || []) {
    if (!user.push_token) {
      result.skipped++;
      continue;
    }

    // Build personalized message
    const greeting = user.first_name ? `Hey ${user.first_name}!` : "Hey!";
    const streakText =
      user.current_streak > 0
        ? `Keep your ${user.current_streak}-day streak going!`
        : "Start a new streak today!";

    const payload = {
      title: "Did you slay today? \u{1F485}", // 💅 emoji
      body: `${greeting} ${streakText}`,
      data: {
        type: "evening_confirmation",
        screen: "confirm_day",
      },
    };

    const sent = await sendPushNotification(user.push_token, payload);
    if (sent) {
      result.notified++;
      console.log(`[EveningConfirmation] Notified user ${user.user_id}`);
    } else {
      result.failed++;
      result.errors.push(`Failed for user ${user.user_id}`);
    }

    // Rate limit: 50ms delay between notifications
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  result.duration_ms = Date.now() - startTime;
  console.log(
    `[EveningConfirmation] Complete: ${result.notified} notified, ${result.failed} failed, ${result.skipped} skipped`
  );
  return result;
}

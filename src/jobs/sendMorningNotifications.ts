/**
 * Morning Notifications Cron Job
 * Sends push notifications to users with pre-generated outfits
 * Runs daily at 9 AM via Railway cron trigger
 */

import { supabaseAdmin } from "../services/supabase.js";

interface NotificationResult {
  success: boolean;
  sent: number;
  failed: number;
  skipped: number;
  errors: string[];
  duration_ms: number;
}

interface UserWithPush {
  id: string;
  push_token: string;
  first_name: string | null;
}

export async function sendMorningNotifications(): Promise<NotificationResult> {
  const startTime = Date.now();

  console.log("[Notifications] ====================================");
  console.log("[Notifications] Starting 9AM push notifications");
  console.log("[Notifications] ====================================");

  const result: NotificationResult = {
    success: true,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    duration_ms: 0,
  };

  try {
    // Step 1: Get users who have pre-generated outfits ready AND have push enabled
    const usersWithOutfits = await getUsersWithReadyOutfits();
    console.log(`[Notifications] ${usersWithOutfits.length} users have outfits ready`);

    if (usersWithOutfits.length === 0) {
      result.duration_ms = Date.now() - startTime;
      return result;
    }

    // Step 2: Send notifications
    for (const user of usersWithOutfits) {
      if (!user.push_token) {
        result.skipped++;
        continue;
      }

      try {
        await sendPushNotification(user);
        result.sent++;
        console.log(`[Notifications] Sent to user ${user.id}`);
      } catch (error) {
        result.failed++;
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        result.errors.push(`User ${user.id}: ${errorMsg}`);
        console.error(`[Notifications] Failed for user ${user.id}:`, errorMsg);
      }

      // Small delay to avoid rate limits
      await sleep(100);
    }

    console.log("[Notifications] ====================================");
    console.log(
      `[Notifications] COMPLETE! Sent: ${result.sent}, Failed: ${result.failed}, Skipped: ${result.skipped}`
    );
    console.log("[Notifications] ====================================");
  } catch (error) {
    result.success = false;
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Fatal: ${errorMsg}`);
    console.error("[Notifications] FATAL ERROR:", error);
  }

  result.duration_ms = Date.now() - startTime;
  return result;
}

async function getUsersWithReadyOutfits(): Promise<UserWithPush[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get users who have pre-generated outfits from today
  const { data: outfitUsers, error: outfitError } = await supabaseAdmin
    .from("generated_outfits")
    .select("user_id")
    .eq("is_pre_generated", true)
    .gte("generated_at", today.toISOString());

  if (outfitError || !outfitUsers) {
    console.error("[Notifications] Failed to get users with outfits:", outfitError);
    return [];
  }

  const userIds = [...new Set(outfitUsers.map((o) => o.user_id))];

  if (userIds.length === 0) return [];

  // Get push tokens for these users
  const { data: users, error: usersError } = await supabaseAdmin
    .from("user_profiles")
    .select("id, push_token, first_name")
    .in("id", userIds)
    .eq("push_enabled", true)
    .not("push_token", "is", null);

  if (usersError) {
    console.error("[Notifications] Failed to get user push tokens:", usersError);
    return [];
  }

  return (users || []) as UserWithPush[];
}

async function sendPushNotification(user: UserWithPush): Promise<void> {
  const greeting = user.first_name ? `Hey ${user.first_name}!` : "Hey!";

  const messages = [
    `${greeting} Your outfits are ready`,
    `${greeting} Time to get styled`,
    `${greeting} Fresh looks waiting for you`,
    `${greeting} Your daily style is here`,
  ];

  const message = messages[Math.floor(Math.random() * messages.length)];

  // APNs push notification payload
  // This is a placeholder - implement actual APNs sending when ready
  // Options:
  // 1. Use a service like OneSignal, Firebase Cloud Messaging, or AWS SNS
  // 2. Direct APNs integration with Apple's push notification service

  const payload = {
    aps: {
      alert: {
        title: "Styleum",
        body: message,
      },
      sound: "default",
      badge: 1,
    },
    data: {
      type: "daily_outfit",
      screen: "style_me",
    },
  };

  // TODO: Implement actual push sending
  // For now, just log the notification
  console.log(`[Notifications] Would send to ${user.id}:`, JSON.stringify(payload));

  // When you implement APNs, replace the above with actual sending:
  // await apnsClient.send(user.push_token, payload);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Hourly Outfit Delivery Cron Job
 * Sends push notifications to users based on their preferred local time
 * Runs every hour and matches users whose preferred notification hour (in their timezone)
 * corresponds to the current UTC hour
 */

import { supabaseAdmin } from "../services/supabase.js";
import { sendPushNotification, isAPNsConfigured } from "../services/apns.js";

interface DeliveryResult {
  success: boolean;
  delivered: number;
  failed: number;
  skipped: number;
  errors: string[];
  duration_ms: number;
}

interface UserForDelivery {
  id: string;
  push_token: string;
  first_name: string | null;
}

export async function deliverOutfits(): Promise<DeliveryResult> {
  const startTime = Date.now();

  console.log("[Delivery] ====================================");
  console.log("[Delivery] Starting hourly outfit delivery");
  console.log("[Delivery] ====================================");

  const result: DeliveryResult = {
    success: true,
    delivered: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    duration_ms: 0,
  };

  // Check if APNs is configured
  if (!isAPNsConfigured()) {
    console.warn("[Delivery] APNs not configured - skipping push notifications");
    result.errors.push("APNs not configured");
    result.duration_ms = Date.now() - startTime;
    return result;
  }

  try {
    // Get current UTC hour
    const now = new Date();
    const currentHour = now.getUTCHours();

    console.log(`[Delivery] Current UTC hour: ${currentHour}`);

    // Find users where it's their preferred notification time
    const { data: users, error: usersError } = await supabaseAdmin.rpc(
      "get_users_for_delivery",
      { current_utc_hour: currentHour }
    );

    if (usersError) {
      throw new Error(`Failed to get users for delivery: ${usersError.message}`);
    }

    const usersToNotify = (users || []) as UserForDelivery[];
    console.log(`[Delivery] Found ${usersToNotify.length} users to notify`);

    if (usersToNotify.length === 0) {
      result.duration_ms = Date.now() - startTime;
      return result;
    }

    // Send notifications
    for (const user of usersToNotify) {
      if (!user.push_token) {
        result.skipped++;
        continue;
      }

      try {
        const greeting = user.first_name ? `${user.first_name}, your` : "Your";

        const sent = await sendPushNotification(user.push_token, {
          title: `${greeting} outfit is ready!`,
          body: "Tap to see what to wear today",
          data: {
            type: "daily_outfit",
            screen: "style_me",
          },
        });

        if (sent) {
          // Mark outfits as delivered
          const { error: updateError } = await supabaseAdmin
            .from("generated_outfits")
            .update({ delivered_at: new Date().toISOString() })
            .eq("user_id", user.id)
            .eq("is_pre_generated", true)
            .is("delivered_at", null)
            .gte("generated_at", getTodayStart());

          if (updateError) {
            console.error(
              `[Delivery] Failed to mark as delivered for ${user.id}:`,
              updateError
            );
          }

          result.delivered++;
          console.log(`[Delivery] Sent to user ${user.id}`);
        } else {
          result.failed++;
          result.errors.push(`User ${user.id}: APNs send failed`);
        }
      } catch (err) {
        result.failed++;
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        result.errors.push(`User ${user.id}: ${errorMsg}`);
        console.error(`[Delivery] Error for user ${user.id}:`, errorMsg);
      }

      // Small delay between notifications to avoid rate limits
      await sleep(50);
    }

    console.log("[Delivery] ====================================");
    console.log(
      `[Delivery] COMPLETE! Delivered: ${result.delivered}, Failed: ${result.failed}, Skipped: ${result.skipped}`
    );
    console.log("[Delivery] ====================================");
  } catch (error) {
    result.success = false;
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Fatal: ${errorMsg}`);
    console.error("[Delivery] FATAL ERROR:", error);
  }

  result.duration_ms = Date.now() - startTime;
  return result;
}

/**
 * Get today's start timestamp in UTC
 */
function getTodayStart(): string {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today.toISOString();
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import { Hono } from "hono";
import * as Sentry from "@sentry/node";
import { supabaseAdmin } from "../services/supabase.js";
import { GRACE_PERIOD_DAYS } from "../constants/tiers.js";
import { addBreadcrumb } from "../utils/sentry.js";

const webhooks = new Hono();

// POST /revenuecat - Handle subscription events
webhooks.post("/revenuecat", async (c) => {
  const webhookSecret = process.env.REVENUECAT_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("REVENUECAT_WEBHOOK_SECRET not configured");
    return c.json({ error: "Webhook not configured" }, 500);
  }

  // Verify Authorization header
  const authHeader = c.req.header("Authorization");
  const expectedAuth = `Bearer ${webhookSecret}`;

  if (!authHeader || authHeader !== expectedAuth) {
    console.warn("Invalid RevenueCat webhook authorization");
    return c.json({ error: "Unauthorized" }, 401);
  }

  const event = await c.req.json();
  const { type, app_user_id, expiration_at_ms } = event.event ?? event;

  if (!app_user_id) {
    return c.json({ error: "Missing app_user_id" }, 400);
  }

  console.log(`RevenueCat webhook: ${type} for user ${app_user_id}`);
  addBreadcrumb("subscription", `Webhook received: ${type}`, { userId: app_user_id });

  switch (type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "PRODUCT_CHANGE":
    case "UNCANCELLATION": {
      // Set is_pro = true, update expiry date, and clear any grace period/billing issues
      const expiryDate = expiration_at_ms
        ? new Date(expiration_at_ms).toISOString()
        : null;

      const { error } = await supabaseAdmin
        .from("user_subscriptions")
        .upsert(
          {
            user_id: app_user_id,
            is_pro: true,
            subscription_tier: "pro",
            expiry_date: expiryDate,
            revenuecat_id: event.event?.original_transaction_id ?? null,
            // Clear grace period and billing issue flags on successful payment
            in_grace_period: false,
            grace_period_expires_at: null,
            has_billing_issue: false,
            billing_issue_detected_at: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

      if (error) {
        console.error("Failed to update subscription:", error);
        Sentry.captureException(error, {
          extra: { event: type, userId: app_user_id },
        });
        return c.json({ error: "Database error" }, 500);
      }

      console.log(`Subscription activated for user ${app_user_id}`);
      break;
    }

    case "CANCELLATION": {
      // User cancelled but still has access until expiry date
      // Just log - no immediate changes needed, access continues until expiration
      console.log(`Subscription cancelled (still active until expiry) for user ${app_user_id}`);
      break;
    }

    case "EXPIRATION": {
      // Subscription expired - start grace period
      // User keeps pro access during grace period to resolve payment issues
      const gracePeriodEnd = new Date();
      gracePeriodEnd.setDate(gracePeriodEnd.getDate() + GRACE_PERIOD_DAYS);

      const { error } = await supabaseAdmin
        .from("user_subscriptions")
        .update({
          is_pro: false, // Mark as not pro (grace period check in isUserPro() handles access)
          subscription_tier: "pro", // Keep tier so they retain features during grace period
          in_grace_period: true,
          grace_period_expires_at: gracePeriodEnd.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", app_user_id);

      if (error) {
        console.error("Failed to update subscription:", error);
        Sentry.captureException(error, {
          extra: { event: type, userId: app_user_id },
        });
        return c.json({ error: "Database error" }, 500);
      }

      console.log(`Subscription expired - ${GRACE_PERIOD_DAYS}-day grace period started for user ${app_user_id}`);
      break;
    }

    case "BILLING_ISSUE": {
      // Mark billing issue - user still has access but needs to resolve payment
      const { error } = await supabaseAdmin
        .from("user_subscriptions")
        .update({
          has_billing_issue: true,
          billing_issue_detected_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", app_user_id);

      if (error) {
        console.error("Failed to update billing issue status:", error);
        Sentry.captureException(error, {
          extra: { event: type, userId: app_user_id },
        });
        return c.json({ error: "Database error" }, 500);
      }

      console.warn(`Billing issue detected for user ${app_user_id}`);
      break;
    }

    default: {
      console.log(`Unhandled RevenueCat event type: ${type}`);
    }
  }

  return c.json({ received: true });
});

export default webhooks;

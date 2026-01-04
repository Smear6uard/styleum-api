import { Hono } from "hono";
import { supabaseAdmin } from "../services/supabase.js";
import { createHmac, timingSafeEqual } from "crypto";

const webhooks = new Hono();

// RevenueCat webhook signature verification
function verifyRevenueCatSignature(
  payload: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;

  const expectedSignature = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  } catch {
    return false;
  }
}

// POST /revenuecat - Handle subscription events
webhooks.post("/revenuecat", async (c) => {
  const webhookSecret = process.env.REVENUECAT_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("REVENUECAT_WEBHOOK_SECRET not configured");
    return c.json({ error: "Webhook not configured" }, 500);
  }

  // Get raw body for signature verification
  const rawBody = await c.req.text();
  const signature = c.req.header("X-RevenueCat-Signature");

  // Verify signature
  if (!verifyRevenueCatSignature(rawBody, signature, webhookSecret)) {
    console.warn("Invalid RevenueCat webhook signature");
    return c.json({ error: "Invalid signature" }, 401);
  }

  const event = JSON.parse(rawBody);
  const { type, app_user_id, expiration_at_ms } = event.event ?? event;

  if (!app_user_id) {
    return c.json({ error: "Missing app_user_id" }, 400);
  }

  console.log(`RevenueCat webhook: ${type} for user ${app_user_id}`);

  switch (type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "PRODUCT_CHANGE":
    case "UNCANCELLATION": {
      // Set is_pro = true and update expiry date
      const expiryDate = expiration_at_ms
        ? new Date(expiration_at_ms).toISOString()
        : null;

      const { error } = await supabaseAdmin
        .from("user_subscriptions")
        .upsert(
          {
            user_id: app_user_id,
            is_pro: true,
            expiry_date: expiryDate,
            revenuecat_id: event.event?.original_transaction_id ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" }
        );

      if (error) {
        console.error("Failed to update subscription:", error);
        return c.json({ error: "Database error" }, 500);
      }

      console.log(`Subscription activated for user ${app_user_id}`);
      break;
    }

    case "CANCELLATION":
    case "EXPIRATION": {
      // Set is_pro = false
      const { error } = await supabaseAdmin
        .from("user_subscriptions")
        .update({
          is_pro: false,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", app_user_id);

      if (error) {
        console.error("Failed to update subscription:", error);
        return c.json({ error: "Database error" }, 500);
      }

      console.log(`Subscription deactivated for user ${app_user_id}`);
      break;
    }

    case "BILLING_ISSUE": {
      // Log for monitoring - could trigger email notification
      console.warn(`Billing issue for user ${app_user_id}`);
      break;
    }

    default: {
      console.log(`Unhandled RevenueCat event type: ${type}`);
    }
  }

  return c.json({ received: true });
});

export default webhooks;

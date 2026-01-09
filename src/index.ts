import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { cors } from "hono/cors";
import "dotenv/config";

import { authMiddleware } from "./middleware/auth.js";
import { trackUserActivity } from "./middleware/trackActivity.js";
import itemsRoutes from "./routes/items.js";
import outfitsRoutes from "./routes/outfits.js";
import gamificationRoutes from "./routes/gamification.js";
import subscriptionsRoutes from "./routes/subscriptions.js";
import webhooksRoutes from "./routes/webhooks.js";
import onboardingRoutes from "./routes/onboarding.js";
import profileRoutes from "./routes/profile.js";
import styleQuizRoutes from "./routes/styleQuiz.js";
import accountRoutes from "./routes/account.js";
import usersRoutes from "./routes/users.js";
import { preGenerateOutfits } from "./jobs/preGenerate.js";
import { sendMorningNotifications } from "./jobs/sendMorningNotifications.js";
import { dailyGamificationReset } from "./jobs/dailyGamificationReset.js";
import { deliverOutfits } from "./jobs/deliverOutfits.js";
import { supabaseAdmin } from "./services/supabase.js";

const CRON_SECRET = process.env.CRON_SECRET;

type Variables = {
  userId: string;
  email: string;
};

const app = new Hono<{ Variables: Variables }>();

// Global middleware
app.use("*", logger());
app.use("*", prettyJSON());
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

// Public routes
app.get("/", (c) => {
  return c.json({
    name: "Styleum API",
    version: "1.0.0",
    status: "running",
  });
});

app.get("/health", (c) => {
  return c.json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Webhook routes (no auth)
app.route("/webhooks", webhooksRoutes);

// Cron endpoint (protected by secret)
app.get("/cron/pre-generate", async (c) => {
  const authHeader = c.req.header("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  console.log("[Cron] Starting pre-generation job via HTTP trigger");

  try {
    const result = await preGenerateOutfits();
    return c.json({
      message: "Pre-generation completed",
      ...result,
    });
  } catch (error) {
    console.error("[Cron] Pre-generation failed:", error);
    return c.json(
      {
        success: false,
        error: "Pre-generation failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// 9AM Morning notifications cron endpoint (legacy - use deliver-outfits instead)
app.get("/cron/morning-notifications", async (c) => {
  const authHeader = c.req.header("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  console.log("[Cron] Starting morning notifications job via HTTP trigger");

  try {
    const result = await sendMorningNotifications();
    return c.json({
      message: "Morning notifications completed",
      ...result,
    });
  } catch (error) {
    console.error("[Cron] Morning notifications failed:", error);
    return c.json(
      {
        success: false,
        error: "Morning notifications failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Midnight daily gamification reset cron endpoint
app.get("/cron/daily-gamification-reset", async (c) => {
  const authHeader = c.req.header("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  console.log("[Cron] Starting daily gamification reset job via HTTP trigger");

  try {
    const result = await dailyGamificationReset();
    return c.json({
      message: "Daily gamification reset completed",
      ...result,
    });
  } catch (error) {
    console.error("[Cron] Daily gamification reset failed:", error);
    return c.json(
      {
        success: false,
        error: "Daily gamification reset failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Hourly outfit delivery cron endpoint (timezone-aware push notifications)
app.get("/cron/deliver-outfits", async (c) => {
  const authHeader = c.req.header("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  console.log("[Cron] Starting hourly outfit delivery via HTTP trigger");

  try {
    const result = await deliverOutfits();
    return c.json({
      message: "Outfit delivery completed",
      ...result,
    });
  } catch (error) {
    console.error("[Cron] Outfit delivery failed:", error);
    return c.json(
      {
        success: false,
        error: "Outfit delivery failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Monthly credit reset cron endpoint (1st of each month at midnight UTC)
app.get("/cron/reset-credits", async (c) => {
  const authHeader = c.req.header("authorization");
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  console.log("[Cron] Starting monthly credit reset job via HTTP trigger");

  try {
    // Reset style_me_credits_used to 0 for all free tier users
    const { data, error } = await supabaseAdmin
      .from("user_subscriptions")
      .update({
        style_me_credits_used: 0,
        style_me_credits_reset_at: new Date().toISOString(),
      })
      .eq("subscription_tier", "free")
      .select("id");

    if (error) {
      throw new Error(`Failed to reset credits: ${error.message}`);
    }

    const resetCount = data?.length ?? 0;
    console.log(`[Cron] Reset credits for ${resetCount} free tier users`);

    return c.json({
      success: true,
      message: "Monthly credit reset completed",
      usersReset: resetCount,
    });
  } catch (error) {
    console.error("[Cron] Credit reset failed:", error);
    return c.json(
      {
        success: false,
        error: "Credit reset failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// Protected API routes
const api = new Hono<{ Variables: Variables }>();
api.use("*", authMiddleware);
api.use("*", trackUserActivity);
api.route("/items", itemsRoutes);
api.route("/outfits", outfitsRoutes);
api.route("/gamification", gamificationRoutes);
api.route("/subscriptions", subscriptionsRoutes);
api.route("/onboarding", onboardingRoutes);
api.route("/profile", profileRoutes);
api.route("/style-quiz", styleQuizRoutes);
api.route("/account", accountRoutes);
api.route("/users", usersRoutes);

app.route("/api", api);

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    {
      error: "Internal server error",
      message: process.env.NODE_ENV === "development" ? err.message : undefined,
    },
    500
  );
});

// Start server
const port = parseInt(process.env.PORT ?? "3000");

console.log(`Starting Styleum API on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
});

console.log(`Styleum API running at http://localhost:${port}`);

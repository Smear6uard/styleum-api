import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { cors } from "hono/cors";
import "dotenv/config";
import cron from "node-cron";

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
import referralsRoutes from "./routes/referrals.js";
import debugRoutes from "./routes/debug.js";
import publicRoutes from "./routes/public.js";
import { preGenerateOutfits } from "./jobs/preGenerate.js";
import { sendMorningNotifications } from "./jobs/sendMorningNotifications.js";
import { dailyGamificationReset } from "./jobs/dailyGamificationReset.js";
import { deliverOutfits } from "./jobs/deliverOutfits.js";
import { supabaseAdmin } from "./services/supabase.js";

const CRON_SECRET = process.env.CRON_SECRET;

// Validate CRON_SECRET at startup to prevent "Bearer undefined" bypass
if (!CRON_SECRET || CRON_SECRET.length < 32) {
  console.error("FATAL: CRON_SECRET must be set and at least 32 characters");
  process.exit(1);
}

/**
 * Initialize internal cron jobs using node-cron
 * These run directly in the Node.js process instead of via HTTP triggers
 */
function initializeCronJobs() {
  console.log("[Cron] Initializing internal cron jobs...");

  // Pre-generate outfits at 9:30 AM UTC (3:30 AM Chicago)
  cron.schedule(
    "30 9 * * *",
    async () => {
      console.log("[Cron] Starting pre-generate job...");
      try {
        const result = await preGenerateOutfits();
        console.log(
          `[Cron] Pre-generate completed: ${result.outfitsGenerated} outfits for ${result.usersProcessed} users`
        );
      } catch (error) {
        console.error("[Cron] Pre-generate failed:", error);
      }
    },
    { timezone: "UTC" }
  );

  // Deliver outfits hourly (timezone-aware push notifications)
  cron.schedule(
    "0 * * * *",
    async () => {
      console.log("[Cron] Starting hourly outfit delivery...");
      try {
        const result = await deliverOutfits();
        console.log(`[Cron] Outfit delivery completed: ${result.delivered} delivered, ${result.failed} failed`);
      } catch (error) {
        console.error("[Cron] Outfit delivery failed:", error);
      }
    },
    { timezone: "UTC" }
  );

  // Daily gamification reset at 10:00 AM UTC (4:00 AM Chicago)
  cron.schedule(
    "0 10 * * *",
    async () => {
      console.log("[Cron] Starting daily gamification reset...");
      try {
        const result = await dailyGamificationReset();
        console.log(
          `[Cron] Gamification reset completed: ${result.users_reset} users, ${result.challenges_generated} challenges`
        );
      } catch (error) {
        console.error("[Cron] Gamification reset failed:", error);
      }
    },
    { timezone: "UTC" }
  );

  // Monthly credit reset on 1st of each month at midnight UTC
  cron.schedule(
    "0 0 1 * *",
    async () => {
      console.log("[Cron] Starting monthly credit reset...");
      try {
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
        console.log(`[Cron] Monthly credit reset completed: ${resetCount} users`);
      } catch (error) {
        console.error("[Cron] Monthly credit reset failed:", error);
      }
    },
    { timezone: "UTC" }
  );

  console.log("[Cron] All cron jobs initialized:");
  console.log("  - Pre-generate outfits: 9:30 AM UTC daily");
  console.log("  - Deliver outfits: Every hour");
  console.log("  - Gamification reset: 10:00 AM UTC daily");
  console.log("  - Monthly credit reset: 1st of month at midnight UTC");
}

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

// Security headers
app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("X-XSS-Protection", "1; mode=block");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  if (process.env.NODE_ENV === "production") {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
});

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

// Public routes (no auth) - for outfit sharing pages
app.route("/api/public", publicRoutes);

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
api.route("/referrals", referralsRoutes);
api.route("/debug", debugRoutes);

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

// Initialize internal cron jobs
initializeCronJobs();

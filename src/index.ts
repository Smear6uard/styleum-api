import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { logger } from "hono/logger";
import { prettyJSON } from "hono/pretty-json";
import { cors } from "hono/cors";
import "dotenv/config";

import { authMiddleware } from "./middleware/auth.js";
import itemsRoutes from "./routes/items.js";
import outfitsRoutes from "./routes/outfits.js";
import gamificationRoutes from "./routes/gamification.js";
import subscriptionsRoutes from "./routes/subscriptions.js";
import webhooksRoutes from "./routes/webhooks.js";
import onboardingRoutes from "./routes/onboarding.js";
import profileRoutes from "./routes/profile.js";
import styleQuizRoutes from "./routes/styleQuiz.js";
import { preGenerateOutfits } from "./jobs/preGenerate.js";

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
  // Verify cron secret
  const providedSecret = c.req.header("X-Cron-Secret") || c.req.query("secret");

  if (!CRON_SECRET) {
    console.error("[Cron] CRON_SECRET not configured");
    return c.json({ error: "Cron not configured" }, 500);
  }

  if (providedSecret !== CRON_SECRET) {
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

// Protected API routes
const api = new Hono<{ Variables: Variables }>();
api.use("*", authMiddleware);
api.route("/items", itemsRoutes);
api.route("/outfits", outfitsRoutes);
api.route("/gamification", gamificationRoutes);
api.route("/subscriptions", subscriptionsRoutes);
api.route("/onboarding", onboardingRoutes);
api.route("/profile", profileRoutes);
api.route("/style-quiz", styleQuizRoutes);

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

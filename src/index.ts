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

// Protected API routes
const api = new Hono<{ Variables: Variables }>();
api.use("*", authMiddleware);
api.route("/items", itemsRoutes);
api.route("/outfits", outfitsRoutes);
api.route("/gamification", gamificationRoutes);
api.route("/subscriptions", subscriptionsRoutes);
api.route("/onboarding", onboardingRoutes);

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

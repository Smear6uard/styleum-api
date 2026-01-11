/**
 * Referral Routes
 * GET /api/referrals - Get user's referral code and stats
 * POST /api/referrals/apply - Apply a referral code
 * GET /api/referrals/validate/:code - Validate a referral code
 */

import { Hono } from "hono";
import { getUserId } from "../middleware/auth.js";
import { ReferralService } from "../services/referrals.js";

type Variables = {
  userId: string;
  email: string;
};

const referrals = new Hono<{ Variables: Variables }>();

/**
 * GET / - Get user's referral code and stats
 */
referrals.get("/", async (c) => {
  const userId = getUserId(c);

  const stats = await ReferralService.getStats(userId);

  if (!stats) {
    return c.json({ error: "Failed to fetch referral info" }, 500);
  }

  return c.json({
    code: stats.code,
    share_url: stats.share_url,
    stats: {
      total_referrals: stats.total_referrals,
      completed_referrals: stats.completed_referrals,
      pending_referrals: stats.pending_referrals,
      total_days_earned: stats.total_days_earned,
    },
  });
});

/**
 * POST /apply - Apply a referral code
 * Body: { code: string }
 */
referrals.post("/apply", async (c) => {
  const userId = getUserId(c);

  const body = await c.req.json().catch(() => ({}));
  const { code } = body;

  if (!code || typeof code !== "string") {
    return c.json({ error: "Referral code is required" }, 400);
  }

  // Validate code format (8 alphanumeric characters)
  const normalizedCode = code.toUpperCase().trim();
  if (!/^[A-Z0-9]{8}$/.test(normalizedCode)) {
    return c.json({ error: "Invalid referral code format" }, 400);
  }

  const result = await ReferralService.applyCode(userId, normalizedCode);

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  return c.json({
    success: true,
    message: result.message,
  });
});

/**
 * GET /validate/:code - Validate a referral code before applying
 */
referrals.get("/validate/:code", async (c) => {
  const userId = getUserId(c);
  const code = c.req.param("code");

  const normalizedCode = code.toUpperCase().trim();
  if (!/^[A-Z0-9]{8}$/.test(normalizedCode)) {
    return c.json({ valid: false, error: "Invalid code format" }, 400);
  }

  const ownerId = await ReferralService.getCodeOwner(normalizedCode);

  if (!ownerId) {
    return c.json({ valid: false, error: "Code not found" });
  }

  if (ownerId === userId) {
    return c.json({ valid: false, error: "Cannot use your own code" });
  }

  return c.json({ valid: true });
});

export default referrals;

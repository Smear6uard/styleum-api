import { Hono } from "hono";
import { supabaseAdmin } from "../services/supabase.js";
import { getUserId } from "../middleware/auth.js";

type Variables = {
  userId: string;
  email: string;
};

const consent = new Hono<{ Variables: Variables }>();

/**
 * POST / - Record user consent for AI data processing
 * Body: { type: "ai_data", agreed: boolean, timestamp: string }
 */
consent.post("/", async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json();

  const { type, agreed, timestamp } = body;

  if (type !== "ai_data" || typeof agreed !== "boolean" || !timestamp) {
    return c.json({ error: "Invalid consent payload" }, 400);
  }

  console.log(`[Consent] Request from user ${userId}: type=${type}, agreed=${agreed}, timestamp=${timestamp}`);

  // Update user_profiles
  const { data: updated, error: profileError } = await supabaseAdmin
    .from("user_profiles")
    .update({ ai_consent_given_at: agreed ? timestamp : null })
    .eq("id", userId)
    .select("ai_consent_given_at")
    .single();

  if (profileError) {
    console.error("[Consent] Failed to update profile:", profileError);
    return c.json({ error: "Failed to update consent" }, 500);
  }

  if (!updated) {
    console.error("[Consent] No profile found for user:", userId);
    return c.json({ error: "User profile not found" }, 404);
  }

  console.log(`[Consent] Updated ai_consent_given_at to ${updated.ai_consent_given_at} for user ${userId}`);

  // Log to consent_log for audit trail
  await supabaseAdmin.from("consent_log").insert({
    user_id: userId,
    consent_type: type,
    agreed,
    timestamp,
    ip_address: c.req.header("x-forwarded-for") || "unknown",
  });

  console.log(`[Consent] User ${userId} ${agreed ? "granted" : "revoked"} AI data consent`);

  return c.json({ success: true });
});

/**
 * GET / - Check user's consent status
 */
consent.get("/", async (c) => {
  const userId = getUserId(c);

  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .select("ai_consent_given_at")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("[Consent] Failed to fetch consent:", error);
    return c.json({ error: "Failed to fetch consent" }, 500);
  }

  return c.json({
    ai_data_consent: !!data?.ai_consent_given_at,
    consented_at: data?.ai_consent_given_at,
  });
});

export default consent;

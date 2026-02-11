import { supabaseAdmin } from "../services/supabase.js";

/**
 * Check if a user has given AI data processing consent.
 * Returns true if consent was given, false otherwise.
 */
export async function hasAIConsent(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("user_profiles")
    .select("ai_consent_given_at")
    .eq("id", userId)
    .single();

  return !!data?.ai_consent_given_at;
}

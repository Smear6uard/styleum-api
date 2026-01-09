import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Type definitions for database tables

export interface WardrobeItem {
  id: string;
  user_id: string;
  image_url: string;
  category: string;
  subcategory: string | null;
  color: string | null;
  brand: string | null;
  material: string | null;
  pattern: string | null;
  occasion: string[] | null;
  season: string[] | null;
  embedding: number[] | null;
  times_worn: number;
  last_worn_at: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  style_preferences: Record<string, unknown> | null;
  tier_onboarding_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserGamification {
  id: string;
  user_id: string;
  total_xp: number;
  level: number;
  current_streak: number;
  longest_streak: number;
  streak_freezes: number;
  last_activity_date: string | null;
  streak_lost_at: string | null;
  achievements: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UserSubscription {
  id: string;
  user_id: string;
  is_pro: boolean;
  subscription_tier: "free" | "pro";
  subscription_platform: "ios" | "android" | "web" | null;
  plan_type: string | null;
  started_at: string | null;
  expiry_date: string | null;
  revenuecat_id: string | null;
  style_me_credits_used: number;
  style_me_credits_reset_at: string | null;
  is_trial: boolean;
  in_grace_period: boolean;
  grace_period_expires_at: string | null;
  has_billing_issue: boolean;
  billing_issue_detected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GeneratedOutfit {
  id: string;
  user_id: string;
  items: string[];
  occasion: string | null;
  style_score: number | null;
  is_saved: boolean;
  expires_at: string;
  created_at: string;
}

export interface OutfitHistory {
  id: string;
  user_id: string;
  outfit_id: string;
  worn_at: string;
  photo_url: string | null;
  xp_awarded: number;
  created_at: string;
}

export interface UserTasteVector {
  id: string;
  user_id: string;
  taste_embedding: number[] | null;
  style_clusters: Record<string, unknown> | null;
  updated_at: string;
}

// Helper functions

export async function getUser(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("Error fetching user:", error);
    return null;
  }
  return data;
}

export async function getUserSubscription(
  userId: string
): Promise<UserSubscription | null> {
  const { data, error } = await supabaseAdmin
    .from("user_subscriptions")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("Error fetching subscription:", error);
    return null;
  }
  return data;
}

export async function getUserGamification(
  userId: string
): Promise<UserGamification | null> {
  const { data, error } = await supabaseAdmin
    .from("user_gamification")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    console.error("Error fetching gamification:", error);
    return null;
  }
  return data;
}

export async function isUserPro(userId: string): Promise<boolean> {
  const subscription = await getUserSubscription(userId);
  if (!subscription) return false;

  const now = new Date();

  // Check if subscription is active (not expired)
  if (subscription.is_pro && subscription.expiry_date) {
    const expiryDate = new Date(subscription.expiry_date);
    if (expiryDate >= now) return true;
  }

  // Check if in grace period (user retains pro access during grace period)
  if (subscription.in_grace_period && subscription.grace_period_expires_at) {
    const gracePeriodExpiry = new Date(subscription.grace_period_expires_at);
    if (gracePeriodExpiry >= now) return true;
  }

  return false;
}

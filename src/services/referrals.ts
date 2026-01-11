/**
 * Referral Service
 * Handles referral code generation, application, and reward distribution
 */

import { supabaseAdmin, getUserSubscription } from "./supabase.js";

const REFERRAL_REWARD_DAYS = 7;

export interface ReferralCode {
  id: string;
  user_id: string;
  code: string;
  created_at: string;
}

export interface Referral {
  id: string;
  referrer_id: string | null;
  referee_id: string;
  code_used: string;
  status: "pending" | "completed";
  applied_at: string;
  completed_at: string | null;
  referrer_reward_applied: boolean;
  referee_reward_applied: boolean;
  created_at: string;
}

export interface ReferralStats {
  code: string;
  share_url: string;
  total_referrals: number;
  completed_referrals: number;
  pending_referrals: number;
  total_days_earned: number;
}

export interface ApplyCodeResult {
  success: boolean;
  error?: string;
  message?: string;
}

export interface RewardResult {
  success: boolean;
  referrer_rewarded: boolean;
  referee_rewarded: boolean;
  days_added: number;
}

export class ReferralService {
  /**
   * Get or create a user's referral code
   */
  static async getUserCode(userId: string): Promise<string | null> {
    // Check if code exists
    const { data: existing } = await supabaseAdmin
      .from("referral_codes")
      .select("code")
      .eq("user_id", userId)
      .single();

    if (existing?.code) {
      return existing.code;
    }

    // Create new code using DB function
    const { data, error } = await supabaseAdmin.rpc("create_user_referral_code", {
      p_user_id: userId,
    });

    if (error) {
      console.error("[Referral] Error creating code:", error);
      return null;
    }

    return data;
  }

  /**
   * Get referral stats for a user
   */
  static async getStats(userId: string): Promise<ReferralStats | null> {
    const code = await this.getUserCode(userId);
    if (!code) return null;

    // Get referral counts
    const { data: referrals } = await supabaseAdmin
      .from("referrals")
      .select("status")
      .eq("referrer_id", userId);

    const total = referrals?.length ?? 0;
    const completed = referrals?.filter((r) => r.status === "completed").length ?? 0;
    const pending = referrals?.filter((r) => r.status === "pending").length ?? 0;

    return {
      code,
      share_url: `https://styleum.app/r/${code}`,
      total_referrals: total,
      completed_referrals: completed,
      pending_referrals: pending,
      total_days_earned: completed * REFERRAL_REWARD_DAYS,
    };
  }

  /**
   * Apply a referral code for a user
   * Called during or after signup
   */
  static async applyCode(userId: string, code: string): Promise<ApplyCodeResult> {
    const normalizedCode = code.toUpperCase().trim();

    // 1. Check if user has already been referred
    const { data: existingReferral } = await supabaseAdmin
      .from("referrals")
      .select("id")
      .eq("referee_id", userId)
      .single();

    if (existingReferral) {
      return { success: false, error: "You have already been referred" };
    }

    // 2. Look up the referral code
    const { data: codeData } = await supabaseAdmin
      .from("referral_codes")
      .select("user_id, code")
      .eq("code", normalizedCode)
      .single();

    if (!codeData) {
      return { success: false, error: "Invalid referral code" };
    }

    // 3. Check if trying to use own code
    if (codeData.user_id === userId) {
      return { success: false, error: "You cannot use your own referral code" };
    }

    // 4. Create the referral record (pending status)
    const { error: insertError } = await supabaseAdmin.from("referrals").insert({
      referrer_id: codeData.user_id,
      referee_id: userId,
      code_used: normalizedCode,
      status: "pending",
    });

    if (insertError) {
      console.error("[Referral] Error applying code:", insertError);
      return { success: false, error: "Failed to apply referral code" };
    }

    console.log(`[Referral] Code ${normalizedCode} applied by user ${userId}`);

    return {
      success: true,
      message: "Referral code applied! Upload your first item to unlock rewards.",
    };
  }

  /**
   * Complete a referral and distribute rewards
   * Called when referee uploads their first item
   */
  static async completeReferral(userId: string): Promise<RewardResult> {
    // 1. Find pending referral for this user
    const { data: referral } = await supabaseAdmin
      .from("referrals")
      .select("*")
      .eq("referee_id", userId)
      .eq("status", "pending")
      .single();

    if (!referral) {
      // No pending referral, nothing to do
      return { success: false, referrer_rewarded: false, referee_rewarded: false, days_added: 0 };
    }

    let referrerRewarded = false;
    let refereeRewarded = false;

    // 2. Award Pro days to referee
    refereeRewarded = await this.awardProDays(userId, REFERRAL_REWARD_DAYS);

    // 3. Award Pro days to referrer (if they still exist)
    if (referral.referrer_id) {
      referrerRewarded = await this.awardProDays(referral.referrer_id, REFERRAL_REWARD_DAYS);
    }

    // 4. Update referral status
    await supabaseAdmin
      .from("referrals")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        referrer_reward_applied: referrerRewarded,
        referee_reward_applied: refereeRewarded,
      })
      .eq("id", referral.id);

    console.log(
      `[Referral] Completed: referee=${userId}, referrer=${referral.referrer_id}, days=${REFERRAL_REWARD_DAYS}`
    );

    return {
      success: true,
      referrer_rewarded: referrerRewarded,
      referee_rewarded: refereeRewarded,
      days_added: REFERRAL_REWARD_DAYS,
    };
  }

  /**
   * Award Pro days to a user (stacks with existing subscription)
   */
  static async awardProDays(userId: string, days: number): Promise<boolean> {
    const subscription = await getUserSubscription(userId);
    const now = new Date();
    let newExpiryDate: Date;

    if (subscription?.expiry_date) {
      const currentExpiry = new Date(subscription.expiry_date);
      // If subscription is still active, stack days on top
      if (currentExpiry > now) {
        newExpiryDate = new Date(currentExpiry.getTime() + days * 24 * 60 * 60 * 1000);
      } else {
        // Expired, start from now
        newExpiryDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      }
    } else {
      // No subscription record or no expiry, start from now
      newExpiryDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    }

    // Upsert subscription record
    const { error } = await supabaseAdmin
      .from("user_subscriptions")
      .upsert(
        {
          user_id: userId,
          is_pro: true,
          subscription_tier: "pro",
          expiry_date: newExpiryDate.toISOString(),
          plan_type: subscription?.plan_type ?? "referral",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (error) {
      console.error("[Referral] Error awarding Pro days:", error);
      return false;
    }

    console.log(
      `[Referral] Awarded ${days} Pro days to user ${userId}, expires ${newExpiryDate.toISOString()}`
    );
    return true;
  }

  /**
   * Check if a user has a pending referral
   */
  static async hasPendingReferral(userId: string): Promise<boolean> {
    const { data } = await supabaseAdmin
      .from("referrals")
      .select("id")
      .eq("referee_id", userId)
      .eq("status", "pending")
      .single();

    return !!data;
  }

  /**
   * Get referral code owner (for validation)
   */
  static async getCodeOwner(code: string): Promise<string | null> {
    const normalizedCode = code.toUpperCase().trim();
    const { data } = await supabaseAdmin
      .from("referral_codes")
      .select("user_id")
      .eq("code", normalizedCode)
      .single();

    return data?.user_id ?? null;
  }
}

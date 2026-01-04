import { supabaseAdmin, isUserPro } from "../services/supabase.js";

export const FREE_ITEM_LIMIT = 35;
export const FREE_CREDIT_LIMIT = 5;
export const PRO_CREDIT_LIMIT = 75;

export interface LimitCheck {
  allowed: boolean;
  used: number;
  limit: number;
}

export async function checkItemLimit(userId: string): Promise<LimitCheck> {
  const isPro = await isUserPro(userId);

  // Pro users have unlimited items
  if (isPro) {
    const { count } = await supabaseAdmin
      .from("wardrobe_items")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_archived", false);

    return {
      allowed: true,
      used: count ?? 0,
      limit: Infinity,
    };
  }

  // Free users have a limit
  const { count } = await supabaseAdmin
    .from("wardrobe_items")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_archived", false);

  const used = count ?? 0;

  return {
    allowed: used < FREE_ITEM_LIMIT,
    used,
    limit: FREE_ITEM_LIMIT,
  };
}

export async function checkCreditLimit(userId: string): Promise<LimitCheck> {
  const isPro = await isUserPro(userId);
  const limit = isPro ? PRO_CREDIT_LIMIT : FREE_CREDIT_LIMIT;

  // Count style generations this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { count } = await supabaseAdmin
    .from("generated_outfits")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", startOfMonth.toISOString());

  const used = count ?? 0;

  return {
    allowed: used < limit,
    used,
    limit,
  };
}

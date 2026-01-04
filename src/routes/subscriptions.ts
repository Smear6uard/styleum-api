import { Hono } from "hono";
import { getUserSubscription, isUserPro } from "../services/supabase.js";
import { checkItemLimit, checkCreditLimit } from "../utils/limits.js";
import { getUserId } from "../middleware/auth.js";

type Variables = {
  userId: string;
  email: string;
};

const subscriptions = new Hono<{ Variables: Variables }>();

// GET /status - Get subscription status with is_active computed
subscriptions.get("/status", async (c) => {
  const userId = getUserId(c);

  const subscription = await getUserSubscription(userId);
  const isPro = await isUserPro(userId);

  if (!subscription) {
    return c.json({
      subscription: null,
      is_active: false,
      is_pro: false,
    });
  }

  return c.json({
    subscription: {
      ...subscription,
      is_active: isPro,
    },
    is_pro: isPro,
  });
});

// GET /limits - Get current usage vs limits for items and credits
subscriptions.get("/limits", async (c) => {
  const userId = getUserId(c);

  const [itemLimit, creditLimit, isPro] = await Promise.all([
    checkItemLimit(userId),
    checkCreditLimit(userId),
    isUserPro(userId),
  ]);

  return c.json({
    is_pro: isPro,
    items: {
      used: itemLimit.used,
      limit: itemLimit.limit === Infinity ? null : itemLimit.limit,
      unlimited: itemLimit.limit === Infinity,
    },
    credits: {
      used: creditLimit.used,
      limit: creditLimit.limit,
      resets_at: getNextMonthStart(),
    },
  });
});

function getNextMonthStart(): string {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return nextMonth.toISOString();
}

export default subscriptions;

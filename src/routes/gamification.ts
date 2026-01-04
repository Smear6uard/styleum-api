import { Hono } from "hono";
import { supabaseAdmin, getUserGamification, isUserPro } from "../services/supabase.js";
import { getUserId } from "../middleware/auth.js";

type Variables = {
  userId: string;
  email: string;
};

const gamification = new Hono<{ Variables: Variables }>();

// GET /stats - Get user's gamification stats (create default if not exists)
gamification.get("/stats", async (c) => {
  const userId = getUserId(c);

  let stats = await getUserGamification(userId);

  // Create default gamification record if not exists
  if (!stats) {
    const { data, error } = await supabaseAdmin
      .from("user_gamification")
      .insert({
        user_id: userId,
        total_xp: 0,
        level: 1,
        current_streak: 0,
        longest_streak: 0,
        streak_freezes: 0,
        achievements: {},
      })
      .select()
      .single();

    if (error) {
      return c.json({ error: "Failed to create gamification record" }, 500);
    }
    stats = data;
  }

  return c.json({ stats });
});

// GET /achievements - Get user's achievements with progress
gamification.get("/achievements", async (c) => {
  const userId = getUserId(c);

  const stats = await getUserGamification(userId);

  if (!stats) {
    return c.json({ achievements: {} });
  }

  // Define achievement definitions with progress tracking
  const achievementDefinitions = [
    { id: "first_outfit", name: "First Steps", description: "Wear your first outfit", target: 1 },
    { id: "wardrobe_10", name: "Growing Wardrobe", description: "Add 10 items to your wardrobe", target: 10 },
    { id: "wardrobe_50", name: "Fashion Collector", description: "Add 50 items to your wardrobe", target: 50 },
    { id: "streak_7", name: "Week Warrior", description: "Maintain a 7-day streak", target: 7 },
    { id: "streak_30", name: "Style Dedicated", description: "Maintain a 30-day streak", target: 30 },
    { id: "xp_1000", name: "Rising Star", description: "Earn 1,000 XP", target: 1000 },
    { id: "xp_10000", name: "Style Expert", description: "Earn 10,000 XP", target: 10000 },
  ];

  // Get item count for wardrobe achievements
  const { count: itemCount } = await supabaseAdmin
    .from("wardrobe_items")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_archived", false);

  // Get outfit wear count
  const { count: wearCount } = await supabaseAdmin
    .from("outfit_history")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  const userAchievements = stats.achievements as Record<string, { unlocked_at: string }>;

  const achievements = achievementDefinitions.map((def) => {
    let current = 0;

    // Calculate progress based on achievement type
    if (def.id.startsWith("wardrobe_")) {
      current = itemCount ?? 0;
    } else if (def.id === "first_outfit") {
      current = wearCount ?? 0;
    } else if (def.id.startsWith("streak_")) {
      current = stats.longest_streak;
    } else if (def.id.startsWith("xp_")) {
      current = stats.total_xp;
    }

    const unlocked = userAchievements[def.id]?.unlocked_at ?? null;

    return {
      ...def,
      current: Math.min(current, def.target),
      progress: Math.min(100, (current / def.target) * 100),
      unlocked,
    };
  });

  return c.json({ achievements });
});

// POST /streak/freeze - Use a streak freeze
gamification.post("/streak/freeze", async (c) => {
  const userId = getUserId(c);

  const stats = await getUserGamification(userId);

  if (!stats) {
    return c.json({ error: "Gamification record not found" }, 404);
  }

  if (stats.streak_freezes <= 0) {
    return c.json({ error: "No streak freezes available" }, 400);
  }

  const { data, error } = await supabaseAdmin
    .from("user_gamification")
    .update({
      streak_freezes: stats.streak_freezes - 1,
      last_activity_date: new Date().toISOString().split("T")[0],
    })
    .eq("user_id", userId)
    .select()
    .single();

  if (error) {
    return c.json({ error: "Failed to use streak freeze" }, 500);
  }

  return c.json({
    success: true,
    remaining_freezes: data.streak_freezes,
  });
});

// POST /streak/restore - Restore lost streak (Pro only, 500 XP, 24h window)
gamification.post("/streak/restore", async (c) => {
  const userId = getUserId(c);

  // Check if user is Pro
  const isPro = await isUserPro(userId);
  if (!isPro) {
    return c.json({ error: "Pro subscription required" }, 403);
  }

  const stats = await getUserGamification(userId);

  if (!stats) {
    return c.json({ error: "Gamification record not found" }, 404);
  }

  // Check if streak was lost within 24 hours
  if (!stats.streak_lost_at) {
    return c.json({ error: "No streak to restore" }, 400);
  }

  const streakLostAt = new Date(stats.streak_lost_at);
  const now = new Date();
  const hoursSinceLost = (now.getTime() - streakLostAt.getTime()) / (1000 * 60 * 60);

  if (hoursSinceLost > 24) {
    return c.json({ error: "Restoration window expired (24 hours)" }, 400);
  }

  // Check if user has enough XP
  const xpCost = 500;
  if (stats.total_xp < xpCost) {
    return c.json({ error: `Insufficient XP (need ${xpCost})` }, 400);
  }

  // Restore streak
  const { data, error } = await supabaseAdmin
    .from("user_gamification")
    .update({
      current_streak: stats.current_streak + 1, // Restore the lost day
      total_xp: stats.total_xp - xpCost,
      streak_lost_at: null,
      last_activity_date: new Date().toISOString().split("T")[0],
    })
    .eq("user_id", userId)
    .select()
    .single();

  if (error) {
    return c.json({ error: "Failed to restore streak" }, 500);
  }

  return c.json({
    success: true,
    xp_spent: xpCost,
    current_streak: data.current_streak,
  });
});

// GET /leaderboard - Top users by XP
gamification.get("/leaderboard", async (c) => {
  const limit = parseInt(c.req.query("limit") ?? "10");

  const { data, error } = await supabaseAdmin
    .from("user_gamification")
    .select("user_id, total_xp, level, current_streak")
    .order("total_xp", { ascending: false })
    .limit(Math.min(limit, 100));

  if (error) {
    return c.json({ error: "Failed to fetch leaderboard" }, 500);
  }

  // Get user display names
  const userIds = data.map((entry) => entry.user_id);
  const { data: profiles } = await supabaseAdmin
    .from("user_profiles")
    .select("id, display_name, avatar_url")
    .in("id", userIds);

  const profileMap = new Map(profiles?.map((p) => [p.id, p]) ?? []);

  const leaderboard = data.map((entry, index) => ({
    rank: index + 1,
    user_id: entry.user_id,
    display_name: profileMap.get(entry.user_id)?.display_name ?? "Anonymous",
    avatar_url: profileMap.get(entry.user_id)?.avatar_url ?? null,
    total_xp: entry.total_xp,
    level: entry.level,
    current_streak: entry.current_streak,
  }));

  return c.json({ leaderboard });
});

export default gamification;

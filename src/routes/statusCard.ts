/**
 * Status Card Routes - Protected Endpoints
 * Generate and cache shareable weekly status cards
 */

import { Hono } from "hono";
import { supabaseAdmin } from "../services/supabase.js";
import { getUserId } from "../middleware/auth.js";
import { generateStatusCard, StatusCardData } from "../services/statusCardGenerator.js";

type Variables = {
  userId: string;
  email: string;
};

const statusCardRoutes = new Hono<{ Variables: Variables }>();

/**
 * GET / - Get or generate user's weekly status card
 * Returns cached card if available, otherwise generates a new one
 */
statusCardRoutes.get("/", async (c) => {
  const userId = getUserId(c);

  try {
    // Get current week start (Monday)
    const weekStart = getWeekStart();

    // Check for cached status card
    const { data: cachedCard } = await supabaseAdmin
      .from("status_cards")
      .select("image_url, created_at")
      .eq("user_id", userId)
      .eq("week_start", weekStart)
      .single();

    if (cachedCard) {
      return c.json({
        image_url: cachedCard.image_url,
        cached: true,
        generated_at: cachedCard.created_at,
        week_start: weekStart,
      });
    }

    // No cached card - need to generate one
    // Get user profile and stats
    const { data: profile, error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .select(`
        id,
        username,
        display_name,
        avatar_url,
        tier,
        school_id
      `)
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return c.json({ error: "Profile not found" }, 404);
    }

    // Get school info if user has one
    let schoolName: string | null = null;
    if (profile.school_id) {
      const { data: school } = await supabaseAdmin
        .from("schools")
        .select("name, short_name")
        .eq("id", profile.school_id)
        .single();

      schoolName = school?.short_name || school?.name || null;
    }

    // Get gamification stats
    const { data: gamification } = await supabaseAdmin
      .from("user_gamification")
      .select("current_streak")
      .eq("user_id", userId)
      .single();

    const currentStreak = gamification?.current_streak || 0;

    // Get weekly vote count
    const { data: weeklyVotes } = await supabaseAdmin
      .from("outfit_history")
      .select("vote_count")
      .eq("user_id", userId)
      .eq("is_public", true)
      .gte("worn_at", `${weekStart}T00:00:00Z`);

    const totalWeeklyVotes = weeklyVotes?.reduce((sum, o) => sum + (o.vote_count || 0), 0) || 0;

    // Get user's rank from leaderboard (if in a school)
    let rank: number | null = null;
    if (profile.school_id) {
      const { data: leaderboardEntry } = await supabaseAdmin
        .from("weekly_leaderboard")
        .select("rank")
        .eq("user_id", userId)
        .eq("school_id", profile.school_id)
        .single();

      rank = leaderboardEntry?.rank || null;
    }

    // Get most recent public outfit photo
    const { data: recentOutfit } = await supabaseAdmin
      .from("outfit_history")
      .select("photo_url")
      .eq("user_id", userId)
      .eq("is_public", true)
      .not("photo_url", "is", null)
      .order("worn_at", { ascending: false })
      .limit(1)
      .single();

    // Build card data
    const cardData: StatusCardData = {
      username: profile.username || profile.display_name || "User",
      tier: profile.tier || "rookie",
      rank: rank,
      school_name: schoolName,
      streak: currentStreak,
      weekly_votes: totalWeeklyVotes,
      outfit_photo_url: recentOutfit?.photo_url || null,
    };

    // Generate the status card
    console.log(`[StatusCard] Generating card for user ${userId}`);
    const imageUrl = await generateStatusCard(cardData);

    // Cache the card
    const { error: cacheError } = await supabaseAdmin
      .from("status_cards")
      .upsert({
        user_id: userId,
        week_start: weekStart,
        image_url: imageUrl,
      }, {
        onConflict: "user_id,week_start",
      });

    if (cacheError) {
      console.error("[StatusCard] Failed to cache card:", cacheError);
      // Continue anyway - card was generated successfully
    }

    return c.json({
      image_url: imageUrl,
      cached: false,
      generated_at: new Date().toISOString(),
      week_start: weekStart,
    });
  } catch (error) {
    console.error("[StatusCard] Error generating card:", error);
    return c.json({ error: "Failed to generate status card" }, 500);
  }
});

/**
 * POST /regenerate - Force regenerate user's status card
 * Useful when user updates their profile or has new stats
 */
statusCardRoutes.post("/regenerate", async (c) => {
  const userId = getUserId(c);

  try {
    const weekStart = getWeekStart();

    // Delete existing cached card
    await supabaseAdmin
      .from("status_cards")
      .delete()
      .eq("user_id", userId)
      .eq("week_start", weekStart);

    // Redirect to GET to regenerate
    // (In actual implementation, we duplicate the logic or use a shared function)
    // For simplicity, we'll return a message to call GET
    return c.json({
      success: true,
      message: "Cache cleared. Call GET /api/status-card to generate a new card.",
    });
  } catch (error) {
    console.error("[StatusCard] Error regenerating card:", error);
    return c.json({ error: "Failed to regenerate status card" }, 500);
  }
});

/**
 * Helper: Get current week start date (Monday) in YYYY-MM-DD format
 */
function getWeekStart(): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  // Adjust to get Monday (day 1); if Sunday (0), go back 6 days
  const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString().split("T")[0];
}

export default statusCardRoutes;

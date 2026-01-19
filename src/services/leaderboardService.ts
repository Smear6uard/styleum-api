/**
 * Leaderboard Service
 * Optimized service for weekly school-based voting competitions
 * Queries the weekly_leaderboard materialized view for performance
 */

import { supabaseAdmin, isUserPro } from "./supabase.js";

// =============================================================================
// Types
// =============================================================================

export interface LeaderboardEntry {
  userId: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  tier: string;
  tierRank: number;
  totalVotes: number;
  outfitsPosted: number;
  currentStreak: number;
  schoolName: string;
}

export interface Voter {
  id: string;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  tier: string;
  votedAt: string;
}

export interface CurrentUserStats {
  rank: number | null;
  tier: string;
  totalVotes: number;
  outfitsPosted: number;
  percentile: number;
}

export interface TierGroup {
  tier: string;
  tierOrder: number;
  entries: LeaderboardEntry[];
}

export interface SchoolLeaderboardResult {
  entries: LeaderboardEntry[];
  tiers: TierGroup[];
  currentUser: CurrentUserStats | null;
  totalParticipants: number;
  weekStart: string;
}

export interface VotersResult {
  voters: Voter[];
  totalCount: number;
  hasMore: boolean;
}

export interface RefreshResult {
  success: boolean;
  durationMs: number;
  message: string;
}

// =============================================================================
// Cache Infrastructure
// =============================================================================

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds
const MIN_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// In-memory caches
const schoolLeaderboardCache = new Map<string, CacheEntry<SchoolLeaderboardResult>>();
let lastRefreshTime: number | null = null;

// Tier ordering
const TIER_ORDER: Record<string, number> = {
  rookie: 1,
  seeker: 2,
  builder: 3,
  maven: 4,
  icon: 5,
  legend: 6,
};

function getTierOrder(tier: string): number {
  return TIER_ORDER[tier] || 0;
}

// =============================================================================
// Leaderboard Service
// =============================================================================

export class LeaderboardService {
  /**
   * Get school leaderboard with tier grouping
   * Results are cached for 60 seconds
   */
  static async getSchoolLeaderboard(
    schoolId: string,
    options?: { tier?: string; limit?: number; userId?: string }
  ): Promise<SchoolLeaderboardResult> {
    const tier = options?.tier;
    const limit = options?.limit || 100;
    const userId = options?.userId;

    // Check cache (only for non-tier-filtered requests)
    const cacheKey = `${schoolId}:${tier || "all"}:${limit}`;
    const cached = schoolLeaderboardCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      // If userId provided, fetch their stats separately
      if (userId) {
        const currentUser = await this.getUserWeeklyStats(userId);
        return { ...cached.data, currentUser };
      }
      return cached.data;
    }

    try {
      // Build query
      let query = supabaseAdmin
        .from("weekly_leaderboard")
        .select("*")
        .eq("school_id", schoolId)
        .order("rank", { ascending: true })
        .limit(limit);

      if (tier) {
        query = query.eq("tier", tier);
      }

      const { data, error } = await query;

      if (error) {
        console.error("[Leaderboard] Error fetching school leaderboard:", error);
        return {
          entries: [],
          tiers: [],
          currentUser: null,
          totalParticipants: 0,
          weekStart: new Date().toISOString(),
        };
      }

      // Get usernames from user_profiles for each user
      const userIds = (data || []).map((row) => row.user_id);
      const { data: profiles } = await supabaseAdmin
        .from("user_profiles")
        .select("id, username")
        .in("id", userIds);

      const usernameMap = new Map(
        (profiles || []).map((p) => [p.id, p.username])
      );

      // Transform to LeaderboardEntry
      const entries: LeaderboardEntry[] = (data || []).map((row) => ({
        userId: row.user_id,
        displayName: row.display_name || "Anonymous",
        username: usernameMap.get(row.user_id) || null,
        avatarUrl: row.avatar_url,
        tier: row.tier,
        tierRank: row.rank,
        totalVotes: row.weekly_votes || 0,
        outfitsPosted: row.weekly_posts || 0,
        currentStreak: row.current_streak || 0,
        schoolName: row.school_name,
      }));

      // Group by tier
      const tierMap = new Map<string, LeaderboardEntry[]>();
      for (const entry of entries) {
        const tierEntries = tierMap.get(entry.tier) || [];
        tierEntries.push(entry);
        tierMap.set(entry.tier, tierEntries);
      }

      const tiers: TierGroup[] = Array.from(tierMap.entries())
        .map(([tierName, tierEntries]) => ({
          tier: tierName,
          tierOrder: getTierOrder(tierName),
          entries: tierEntries,
        }))
        .sort((a, b) => b.tierOrder - a.tierOrder); // Higher tiers first

      // Get total count
      const { count } = await supabaseAdmin
        .from("weekly_leaderboard")
        .select("*", { count: "exact", head: true })
        .eq("school_id", schoolId);

      const weekStart = data?.[0]?.week_start || new Date().toISOString();

      const result: SchoolLeaderboardResult = {
        entries,
        tiers,
        currentUser: null,
        totalParticipants: count || 0,
        weekStart,
      };

      // Cache the result
      schoolLeaderboardCache.set(cacheKey, {
        data: result,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });

      // If userId provided, fetch their stats
      if (userId) {
        const currentUser = await this.getUserWeeklyStats(userId);
        return { ...result, currentUser };
      }

      return result;
    } catch (err) {
      console.error("[Leaderboard] Exception fetching school leaderboard:", err);
      return {
        entries: [],
        tiers: [],
        currentUser: null,
        totalParticipants: 0,
        weekStart: new Date().toISOString(),
      };
    }
  }

  /**
   * Get voters for a user's outfits this week (Pro-only feature)
   */
  static async getUserVoters(
    userId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<VotersResult> {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    try {
      // Check if user is Pro
      const isPro = await isUserPro(userId);
      if (!isPro) {
        return {
          voters: [],
          totalCount: 0,
          hasMore: false,
        };
      }

      // Get current week start
      const now = new Date();
      const dayOfWeek = now.getDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - diff);
      weekStart.setHours(0, 0, 0, 0);
      const weekStartStr = weekStart.toISOString();

      // Get votes on user's public outfits this week
      const { data: votes, error: votesError, count } = await supabaseAdmin
        .from("votes")
        .select(
          `
          id,
          created_at,
          user_id,
          outfit_history!inner (
            id,
            user_id,
            is_public,
            worn_at
          )
        `,
          { count: "exact" }
        )
        .eq("outfit_history.user_id", userId)
        .eq("outfit_history.is_public", true)
        .gte("outfit_history.worn_at", weekStartStr)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (votesError) {
        console.error("[Leaderboard] Error fetching voters:", votesError);
        return { voters: [], totalCount: 0, hasMore: false };
      }

      if (!votes || votes.length === 0) {
        return { voters: [], totalCount: count || 0, hasMore: false };
      }

      // Get voter profiles
      const voterIds = votes.map((v) => v.user_id);
      const { data: profiles } = await supabaseAdmin
        .from("user_profiles")
        .select("id, display_name, username, avatar_url, tier")
        .in("id", voterIds);

      const profileMap = new Map(
        (profiles || []).map((p) => [p.id, p])
      );

      const voters: Voter[] = votes.map((vote) => {
        const profile = profileMap.get(vote.user_id);
        return {
          id: vote.user_id,
          displayName: profile?.display_name || "Anonymous",
          username: profile?.username || null,
          avatarUrl: profile?.avatar_url || null,
          tier: profile?.tier || "rookie",
          votedAt: vote.created_at,
        };
      });

      return {
        voters,
        totalCount: count || 0,
        hasMore: (offset + limit) < (count || 0),
      };
    } catch (err) {
      console.error("[Leaderboard] Exception fetching voters:", err);
      return { voters: [], totalCount: 0, hasMore: false };
    }
  }

  /**
   * Get weekly stats for a specific user
   */
  static async getUserWeeklyStats(userId: string): Promise<CurrentUserStats | null> {
    try {
      const { data, error } = await supabaseAdmin
        .from("weekly_leaderboard")
        .select("rank, tier, weekly_votes, weekly_posts, school_id")
        .eq("user_id", userId)
        .single();

      if (error) {
        if (error.code === "PGRST116") {
          // User not in leaderboard (no school or no activity)
          return null;
        }
        console.error("[Leaderboard] Error fetching user stats:", error);
        return null;
      }

      // Calculate percentile within the school
      let percentile = 0;
      if (data.school_id && data.rank) {
        const { count } = await supabaseAdmin
          .from("weekly_leaderboard")
          .select("*", { count: "exact", head: true })
          .eq("school_id", data.school_id);

        if (count && count > 0) {
          // Percentile: what percentage of users you're ahead of
          percentile = Math.round(((count - data.rank) / count) * 100);
        }
      }

      return {
        rank: data.rank,
        tier: data.tier,
        totalVotes: data.weekly_votes || 0,
        outfitsPosted: data.weekly_posts || 0,
        percentile: Math.max(0, percentile),
      };
    } catch (err) {
      console.error("[Leaderboard] Exception fetching user stats:", err);
      return null;
    }
  }

  /**
   * Refresh the weekly leaderboard materialized view
   * Has a 5-minute cooldown to prevent abuse
   */
  static async refreshLeaderboard(): Promise<RefreshResult> {
    const now = Date.now();

    // Check cooldown
    if (lastRefreshTime && (now - lastRefreshTime) < MIN_REFRESH_INTERVAL_MS) {
      const remainingMs = MIN_REFRESH_INTERVAL_MS - (now - lastRefreshTime);
      const remainingSecs = Math.ceil(remainingMs / 1000);
      return {
        success: false,
        durationMs: 0,
        message: `Refresh on cooldown. Try again in ${remainingSecs} seconds.`,
      };
    }

    try {
      const startTime = Date.now();

      const { error } = await supabaseAdmin.rpc("refresh_weekly_leaderboard");

      if (error) {
        console.error("[Leaderboard] Error refreshing leaderboard:", error);
        return {
          success: false,
          durationMs: Date.now() - startTime,
          message: error.message,
        };
      }

      const durationMs = Date.now() - startTime;

      // Update cooldown timestamp
      lastRefreshTime = Date.now();

      // Clear caches
      schoolLeaderboardCache.clear();

      console.log(`[Leaderboard] Refreshed materialized view in ${durationMs}ms`);

      return {
        success: true,
        durationMs,
        message: `Leaderboard refreshed successfully in ${durationMs}ms`,
      };
    } catch (err) {
      console.error("[Leaderboard] Exception refreshing leaderboard:", err);
      return {
        success: false,
        durationMs: 0,
        message: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  /**
   * Get leaderboard by school slug (convenience method)
   */
  static async getSchoolLeaderboardBySlug(
    schoolSlug: string,
    options?: { tier?: string; limit?: number; userId?: string }
  ): Promise<SchoolLeaderboardResult> {
    try {
      // Look up school by slug
      const { data: school, error } = await supabaseAdmin
        .from("schools")
        .select("id")
        .eq("slug", schoolSlug)
        .single();

      if (error || !school) {
        console.error("[Leaderboard] School not found:", schoolSlug);
        return {
          entries: [],
          tiers: [],
          currentUser: null,
          totalParticipants: 0,
          weekStart: new Date().toISOString(),
        };
      }

      return this.getSchoolLeaderboard(school.id, options);
    } catch (err) {
      console.error("[Leaderboard] Exception in getSchoolLeaderboardBySlug:", err);
      return {
        entries: [],
        tiers: [],
        currentUser: null,
        totalParticipants: 0,
        weekStart: new Date().toISOString(),
      };
    }
  }

  /**
   * Clear all caches (useful for testing or manual refresh)
   */
  static clearCaches(): void {
    schoolLeaderboardCache.clear();
    lastRefreshTime = null;
  }
}

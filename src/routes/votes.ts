/**
 * Votes Routes - Protected Endpoints
 * Cast and remove votes on public outfits
 */

import { Hono } from "hono";
import { supabaseAdmin } from "../services/supabase.js";
import { getUserId } from "../middleware/auth.js";
import {
  checkVoteAllowed,
  recordVote,
  setVoteRateLimitHeaders,
  VoteRateLimitError,
} from "../middleware/voteRateLimit.js";

type Variables = {
  userId: string;
  email: string;
};

const votesRoutes = new Hono<{ Variables: Variables }>();

/**
 * POST / - Cast a vote on an outfit
 * Body: { outfit_history_id: string }
 * Validates: outfit exists, is_public=true, not own outfit
 * Rate limits: 100/day total, 5/day per target user, 1s cooldown
 */
votesRoutes.post("/", async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => ({}));
  const { outfit_history_id } = body;

  if (!outfit_history_id) {
    return c.json({ error: "outfit_history_id is required" }, 400);
  }

  try {
    // Verify the outfit exists, is public, and not owned by the voter
    const { data: outfit, error: outfitError } = await supabaseAdmin
      .from("outfit_history")
      .select("id, user_id, is_public")
      .eq("id", outfit_history_id)
      .single();

    if (outfitError || !outfit) {
      return c.json({ error: "Outfit not found" }, 404);
    }

    if (!outfit.is_public) {
      return c.json({ error: "Cannot vote on private outfits" }, 403);
    }

    if (outfit.user_id === userId) {
      return c.json({ error: "Cannot vote on your own outfit" }, 403);
    }

    // Check rate limits before proceeding
    const targetUserId = outfit.user_id;
    try {
      checkVoteAllowed(userId, targetUserId);
    } catch (error) {
      if (error instanceof VoteRateLimitError) {
        setVoteRateLimitHeaders(c, userId);
        return c.json(
          {
            error: "rate_limit",
            code: error.code,
            message: error.message,
            retry_after: error.retryAfter,
          },
          429
        );
      }
      throw error;
    }

    // Set rate limit headers
    setVoteRateLimitHeaders(c, userId);

    // Check if user already voted
    const { data: existingVote } = await supabaseAdmin
      .from("votes")
      .select("id")
      .eq("user_id", userId)
      .eq("outfit_history_id", outfit_history_id)
      .single();

    if (existingVote) {
      return c.json({ error: "Already voted on this outfit" }, 409);
    }

    // Create the vote
    const { error: voteError } = await supabaseAdmin.from("votes").insert({
      user_id: userId,
      outfit_history_id,
    });

    if (voteError) {
      console.error("[Votes] Failed to create vote:", voteError);
      return c.json({ error: "Failed to cast vote" }, 500);
    }

    // Record the vote for rate limiting (only after successful insert)
    recordVote(userId, targetUserId);

    // Increment the denormalized vote count
    const { error: incrementError } = await supabaseAdmin.rpc(
      "increment_vote_count",
      { outfit_id: outfit_history_id }
    );

    if (incrementError) {
      console.error("[Votes] Failed to increment count:", incrementError);
      // Vote was created, just log the error
    }

    console.log(`[Votes] User ${userId} voted on outfit ${outfit_history_id}`);

    return c.json({
      success: true,
      message: "Vote cast successfully",
    });
  } catch (error) {
    console.error("[Votes] Error casting vote:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * DELETE /:outfit_history_id - Remove a vote from an outfit
 */
votesRoutes.delete("/:outfit_history_id", async (c) => {
  const userId = getUserId(c);
  const outfitHistoryId = c.req.param("outfit_history_id");

  try {
    // Find and delete the vote
    const { data: deletedVote, error: deleteError } = await supabaseAdmin
      .from("votes")
      .delete()
      .eq("user_id", userId)
      .eq("outfit_history_id", outfitHistoryId)
      .select("id")
      .single();

    if (deleteError || !deletedVote) {
      return c.json({ error: "Vote not found" }, 404);
    }

    // Decrement the denormalized vote count
    const { error: decrementError } = await supabaseAdmin.rpc(
      "decrement_vote_count",
      { outfit_id: outfitHistoryId }
    );

    if (decrementError) {
      console.error("[Votes] Failed to decrement count:", decrementError);
      // Vote was deleted, just log the error
    }

    console.log(`[Votes] User ${userId} removed vote from outfit ${outfitHistoryId}`);

    return c.json({
      success: true,
      message: "Vote removed successfully",
    });
  } catch (error) {
    console.error("[Votes] Error removing vote:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * GET /my - Get all outfits the user has voted on
 * Useful for showing which outfits in feed user has already voted on
 */
votesRoutes.get("/my", async (c) => {
  const userId = getUserId(c);

  try {
    const { data: votes, error } = await supabaseAdmin
      .from("votes")
      .select("outfit_history_id, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[Votes] Failed to fetch user votes:", error);
      return c.json({ error: "Failed to fetch votes" }, 500);
    }

    return c.json({
      votes: votes || [],
      total: votes?.length || 0,
    });
  } catch (error) {
    console.error("[Votes] Error fetching user votes:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default votesRoutes;

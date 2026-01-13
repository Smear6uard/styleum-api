import { Hono } from "hono";
import { supabaseAdmin } from "../services/supabase.js";
import { getUserId } from "../middleware/auth.js";
import { initializeTasteVector } from "../services/tasteVector.js";

type Variables = {
  userId: string;
  email: string;
};

const styleQuiz = new Hono<{ Variables: Variables }>();

/**
 * POST /submit - Submit or retake style quiz results
 * Supports both initial submission and retakes (taste vector uses UPSERT)
 * Body:
 *   - liked_style_ids: string[] (UUIDs of liked style reference images)
 *   - disliked_style_ids: string[] (UUIDs of disliked style reference images)
 */
styleQuiz.post("/submit", async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json();

  // Accept both snake_case and camelCase
  const liked_style_ids = body.liked_style_ids || body.likedStyleIds || [];
  const disliked_style_ids =
    body.disliked_style_ids || body.dislikedStyleIds || [];

  // Validate arrays
  if (!Array.isArray(liked_style_ids) || !Array.isArray(disliked_style_ids)) {
    return c.json(
      { error: "liked_style_ids and disliked_style_ids arrays required" },
      400
    );
  }

  const totalSwipes = liked_style_ids.length + disliked_style_ids.length;

  try {
    // Initialize/update taste vector
    await initializeTasteVector(userId, liked_style_ids, disliked_style_ids);

    // Update profile
    const { error: updateError } = await supabaseAdmin
      .from("user_profiles")
      .update({
        style_quiz_completed: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (updateError) {
      console.error("[StyleQuiz] Failed to update profile:", updateError);
      return c.json({ error: "Failed to save quiz results" }, 500);
    }

    return c.json({
      success: true,
      message: "Style quiz completed",
      stats: {
        likes: liked_style_ids.length,
        dislikes: disliked_style_ids.length,
        total: totalSwipes,
      },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[StyleQuiz] Failed to complete quiz:", errorMessage);
    return c.json({ error: "Failed to save quiz results" }, 500);
  }
});

export default styleQuiz;

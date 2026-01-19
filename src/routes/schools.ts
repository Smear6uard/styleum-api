/**
 * Schools Routes - Public Endpoints
 * List and get schools for campus competition feature
 */

import { Hono } from "hono";
import { supabaseAdmin } from "../services/supabase.js";

const schoolsRoutes = new Hono();

/**
 * GET / - List all active schools
 * Returns schools with user counts for display in school picker
 */
schoolsRoutes.get("/", async (c) => {
  try {
    // Get active schools with user counts
    const { data: schools, error } = await supabaseAdmin
      .from("schools")
      .select(`
        id,
        name,
        short_name,
        slug,
        location,
        logo_url,
        is_active
      `)
      .eq("is_active", true)
      .order("name");

    if (error) {
      console.error("[Schools] Failed to fetch schools:", error);
      return c.json({ error: "Failed to fetch schools" }, 500);
    }

    // Get user counts per school
    const { data: userCounts, error: countError } = await supabaseAdmin
      .from("user_profiles")
      .select("school_id")
      .not("school_id", "is", null);

    if (countError) {
      console.error("[Schools] Failed to fetch user counts:", countError);
    }

    // Count users per school
    const countMap = new Map<string, number>();
    for (const row of userCounts || []) {
      const count = countMap.get(row.school_id) || 0;
      countMap.set(row.school_id, count + 1);
    }

    // Attach user counts to schools
    const schoolsWithCounts = schools.map((school) => ({
      ...school,
      user_count: countMap.get(school.id) || 0,
    }));

    return c.json({
      schools: schoolsWithCounts,
      total: schoolsWithCounts.length,
    });
  } catch (error) {
    console.error("[Schools] Error:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

/**
 * GET /:slug - Get a single school by slug
 * Returns detailed school info with user count
 */
schoolsRoutes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");

  try {
    const { data: school, error } = await supabaseAdmin
      .from("schools")
      .select(`
        id,
        name,
        short_name,
        slug,
        location,
        logo_url,
        is_active,
        created_at
      `)
      .eq("slug", slug)
      .single();

    if (error || !school) {
      return c.json({ error: "School not found" }, 404);
    }

    // Get user count for this school
    const { count, error: countError } = await supabaseAdmin
      .from("user_profiles")
      .select("*", { count: "exact", head: true })
      .eq("school_id", school.id);

    if (countError) {
      console.error("[Schools] Failed to fetch user count:", countError);
    }

    return c.json({
      ...school,
      user_count: count || 0,
    });
  } catch (error) {
    console.error("[Schools] Error fetching school:", error);
    return c.json({ error: "Internal server error" }, 500);
  }
});

export default schoolsRoutes;

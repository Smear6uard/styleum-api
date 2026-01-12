-- Fix ambiguous 'category' column reference in check_achievements function
-- The category column exists in both wardrobe_items and achievements tables
-- This migration qualifies all column references to avoid ambiguity

CREATE OR REPLACE FUNCTION check_achievements(p_user_id UUID)
RETURNS TABLE (
    achievement_id TEXT,
    achievement_name TEXT,
    achievement_description TEXT,
    xp_reward INTEGER,
    rarity TEXT,
    category TEXT,
    newly_unlocked BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item_count INTEGER;
    v_outfit_count INTEGER;
    v_verified_count INTEGER;
    v_current_streak INTEGER;
    v_longest_streak INTEGER;
    v_total_xp INTEGER;
    v_category_count INTEGER;
    v_season_count INTEGER;
    v_color_count INTEGER;
    v_share_count INTEGER;
    v_max_score INTEGER;
    v_daily_goals_streak INTEGER;
BEGIN
    -- Gather all metrics
    SELECT COUNT(*) INTO v_item_count
    FROM wardrobe_items wi WHERE wi.user_id = p_user_id AND wi.is_archived = FALSE;

    SELECT COUNT(*) INTO v_outfit_count
    FROM outfit_history oh WHERE oh.user_id = p_user_id;

    SELECT COUNT(*) INTO v_verified_count
    FROM outfit_history oh WHERE oh.user_id = p_user_id AND oh.is_verified = TRUE;

    SELECT ug.current_streak, ug.longest_streak, ug.total_xp, COALESCE(ug.total_outfits_shared, 0), COALESCE(ug.daily_goals_streak, 0)
    INTO v_current_streak, v_longest_streak, v_total_xp, v_share_count, v_daily_goals_streak
    FROM user_gamification ug WHERE ug.user_id = p_user_id;

    -- FIX: Qualify category with table alias to avoid ambiguity
    SELECT COUNT(DISTINCT wi.category) INTO v_category_count
    FROM wardrobe_items wi WHERE wi.user_id = p_user_id AND wi.is_archived = FALSE AND wi.category IS NOT NULL;

    -- Count distinct seasons (unnest the array)
    SELECT COUNT(DISTINCT s) INTO v_season_count
    FROM wardrobe_items wi, UNNEST(wi.seasons) s
    WHERE wi.user_id = p_user_id AND wi.is_archived = FALSE;

    -- Count distinct primary colors
    SELECT COUNT(DISTINCT wi.colors->>'primary') INTO v_color_count
    FROM wardrobe_items wi
    WHERE wi.user_id = p_user_id AND wi.is_archived = FALSE AND wi.colors->>'primary' IS NOT NULL;

    -- Max style score (as percentage)
    SELECT COALESCE(MAX((go.style_score * 100)::INTEGER), 0) INTO v_max_score
    FROM outfit_history oh
    JOIN generated_outfits go ON oh.outfit_id = go.id
    WHERE oh.user_id = p_user_id;

    -- Check each achievement
    RETURN QUERY
    WITH current_values AS (
        SELECT
            a.id,
            a.name,
            a.description,
            a.xp_reward,
            a.rarity,
            a.category,
            a.requirement_type,
            a.requirement_value,
            CASE a.requirement_type
                WHEN 'items_uploaded' THEN v_item_count
                WHEN 'outfits_worn' THEN v_outfit_count
                WHEN 'verified_outfits' THEN v_verified_count
                WHEN 'streak_days' THEN COALESCE(v_longest_streak, 0)
                WHEN 'total_xp' THEN COALESCE(v_total_xp, 0)
                WHEN 'categories_owned' THEN v_category_count
                WHEN 'seasons_covered' THEN v_season_count
                WHEN 'colors_owned' THEN v_color_count
                WHEN 'outfits_shared' THEN COALESCE(v_share_count, 0)
                WHEN 'max_style_score' THEN v_max_score
                WHEN 'daily_goals_streak' THEN COALESCE(v_daily_goals_streak, 0)
                ELSE 0
            END AS current_value,
            ua.is_unlocked
        FROM achievements a
        LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = p_user_id
    )
    SELECT
        cv.id,
        cv.name,
        cv.description,
        cv.xp_reward,
        cv.rarity,
        cv.category,
        (cv.current_value >= cv.requirement_value AND NOT COALESCE(cv.is_unlocked, FALSE)) AS newly_unlocked
    FROM current_values cv
    WHERE cv.current_value >= cv.requirement_value
    AND NOT COALESCE(cv.is_unlocked, FALSE);
END;
$$;

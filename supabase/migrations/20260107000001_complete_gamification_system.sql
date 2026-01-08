-- =====================================================
-- COMPLETE GAMIFICATION SYSTEM MIGRATION
-- Implements Duolingo-style gamification with:
-- - XP transactions & history
-- - Levels with titles
-- - Daily/Weekly challenges
-- - Expanded achievements (33 total)
-- - Daily activity tracking
-- - Streak management with timezone support
-- =====================================================

-- =====================================================
-- 1. NEW TABLES
-- =====================================================

-- XP Transactions Log
CREATE TABLE IF NOT EXISTS xp_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    amount INTEGER NOT NULL,
    source TEXT NOT NULL,
    source_id UUID,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_xp_transactions_user_created
ON xp_transactions (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_xp_transactions_user_source
ON xp_transactions (user_id, source);

-- Levels Definition Table
CREATE TABLE IF NOT EXISTS levels (
    level INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    min_xp INTEGER NOT NULL,
    max_xp INTEGER,
    badge_icon TEXT,
    color_hex TEXT
);

-- Daily Challenge Templates
CREATE TABLE IF NOT EXISTS daily_challenges (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    challenge_type TEXT NOT NULL,
    target_value INTEGER NOT NULL,
    xp_reward INTEGER NOT NULL,
    difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    is_pro_only BOOLEAN DEFAULT FALSE,
    icon TEXT,
    active BOOLEAN DEFAULT TRUE
);

-- User's Active Daily Challenges
CREATE TABLE IF NOT EXISTS user_daily_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    challenge_id TEXT REFERENCES daily_challenges(id) NOT NULL,
    challenge_date DATE NOT NULL,
    progress INTEGER DEFAULT 0,
    target INTEGER NOT NULL,
    is_completed BOOLEAN DEFAULT FALSE,
    is_claimed BOOLEAN DEFAULT FALSE,
    xp_reward INTEGER NOT NULL,
    completed_at TIMESTAMPTZ,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, challenge_id, challenge_date)
);

CREATE INDEX IF NOT EXISTS idx_user_daily_challenges_user_date
ON user_daily_challenges (user_id, challenge_date);

CREATE INDEX IF NOT EXISTS idx_user_daily_challenges_unclaimed
ON user_daily_challenges (user_id, is_completed, is_claimed)
WHERE is_completed = TRUE AND is_claimed = FALSE;

-- Weekly Challenge Templates
CREATE TABLE IF NOT EXISTS weekly_challenges (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    challenge_type TEXT NOT NULL,
    target_value INTEGER NOT NULL,
    xp_reward INTEGER NOT NULL,
    is_pro_only BOOLEAN DEFAULT FALSE,
    icon TEXT,
    active BOOLEAN DEFAULT TRUE
);

-- User's Active Weekly Challenges
CREATE TABLE IF NOT EXISTS user_weekly_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    challenge_id TEXT REFERENCES weekly_challenges(id) NOT NULL,
    week_start DATE NOT NULL,
    progress INTEGER DEFAULT 0,
    target INTEGER NOT NULL,
    is_completed BOOLEAN DEFAULT FALSE,
    is_claimed BOOLEAN DEFAULT FALSE,
    xp_reward INTEGER NOT NULL,
    completed_at TIMESTAMPTZ,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, challenge_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_user_weekly_challenges_user_week
ON user_weekly_challenges (user_id, week_start);

-- Daily Activity Calendar
CREATE TABLE IF NOT EXISTS daily_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    activity_date DATE NOT NULL,
    xp_earned INTEGER DEFAULT 0,
    outfits_worn INTEGER DEFAULT 0,
    outfits_generated INTEGER DEFAULT 0,
    items_added INTEGER DEFAULT 0,
    streak_maintained BOOLEAN DEFAULT FALSE,
    freeze_used BOOLEAN DEFAULT FALSE,
    challenges_completed INTEGER DEFAULT 0,
    daily_goal_met BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, activity_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_activity_user_date
ON daily_activity (user_id, activity_date DESC);

CREATE INDEX IF NOT EXISTS idx_daily_activity_calendar
ON daily_activity (user_id, activity_date)
WHERE xp_earned > 0;

-- =====================================================
-- 2. SCHEMA MODIFICATIONS
-- =====================================================

-- Add columns to user_gamification
ALTER TABLE user_gamification
ADD COLUMN IF NOT EXISTS total_outfits_worn INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_items_added INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_outfits_generated INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_outfits_shared INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_streak_activity_date DATE,
ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Chicago',
ADD COLUMN IF NOT EXISTS daily_goals_streak INTEGER DEFAULT 0;

-- =====================================================
-- 3. SEED DATA - LEVELS
-- =====================================================

INSERT INTO levels (level, title, min_xp, max_xp, badge_icon, color_hex) VALUES
(1, 'Style Newbie', 0, 99, 'seedling', '#9CA3AF'),
(2, 'Wardrobe Explorer', 100, 249, 'compass', '#6B7280'),
(3, 'Outfit Apprentice', 250, 499, 'shirt', '#8B5CF6'),
(4, 'Fashion Learner', 500, 849, 'book-open', '#3B82F6'),
(5, 'Style Enthusiast', 850, 1299, 'star', '#10B981'),
(6, 'Trend Spotter', 1300, 1899, 'eye', '#F59E0B'),
(7, 'Fashion Curator', 1900, 2599, 'palette', '#EF4444'),
(8, 'Style Maven', 2600, 3499, 'crown', '#EC4899'),
(9, 'Fashion Expert', 3500, 4999, 'award', '#8B5CF6'),
(10, 'Style Legend', 5000, NULL, 'gem', '#F59E0B')
ON CONFLICT (level) DO UPDATE SET
    title = EXCLUDED.title,
    min_xp = EXCLUDED.min_xp,
    max_xp = EXCLUDED.max_xp,
    badge_icon = EXCLUDED.badge_icon,
    color_hex = EXCLUDED.color_hex;

-- =====================================================
-- 4. SEED DATA - ACHIEVEMENTS (33 total)
-- =====================================================

-- Clear existing achievements and insert comprehensive list
DELETE FROM user_achievements;
DELETE FROM achievements;

INSERT INTO achievements (id, name, description, category, rarity, xp_reward, requirement_type, requirement_value, icon, is_pro_only) VALUES
-- Wardrobe Achievements (10)
('first_item', 'First Steps', 'Upload your first wardrobe item', 'wardrobe', 'common', 10, 'items_uploaded', 1, 'shirt', FALSE),
('wardrobe_10', 'Getting Started', 'Upload 10 items to your wardrobe', 'wardrobe', 'common', 25, 'items_uploaded', 10, 'archive', FALSE),
('wardrobe_25', 'Growing Collection', 'Upload 25 items to your wardrobe', 'wardrobe', 'uncommon', 50, 'items_uploaded', 25, 'box', FALSE),
('wardrobe_50', 'Fashion Collector', 'Upload 50 items to your wardrobe', 'wardrobe', 'rare', 100, 'items_uploaded', 50, 'library', FALSE),
('wardrobe_100', 'Master Curator', 'Upload 100 items to your wardrobe', 'wardrobe', 'epic', 250, 'items_uploaded', 100, 'crown', TRUE),
('category_5', 'Variety Pack', 'Own items in 5 different categories', 'wardrobe', 'uncommon', 40, 'categories_owned', 5, 'grid', FALSE),
('category_complete', 'Full Spectrum', 'Own items in all 7 core categories', 'wardrobe', 'rare', 75, 'categories_owned', 7, 'check-circle', FALSE),
('seasonal_2', 'Two Seasons', 'Have items for 2 different seasons', 'wardrobe', 'common', 20, 'seasons_covered', 2, 'sun', FALSE),
('seasonal_4', 'Year-Round Ready', 'Have items for all 4 seasons', 'wardrobe', 'uncommon', 50, 'seasons_covered', 4, 'calendar', FALSE),
('color_master', 'Color Collector', 'Own items in 10+ different primary colors', 'wardrobe', 'rare', 75, 'colors_owned', 10, 'palette', FALSE),

-- Outfit Achievements (8)
('first_outfit', 'Style Debut', 'Wear your first outfit', 'outfits', 'common', 15, 'outfits_worn', 1, 'sparkles', FALSE),
('outfit_10', 'Regular Stylist', 'Wear 10 different outfits', 'outfits', 'common', 30, 'outfits_worn', 10, 'repeat', FALSE),
('outfit_25', 'Style Enthusiast', 'Wear 25 different outfits', 'outfits', 'uncommon', 60, 'outfits_worn', 25, 'star', FALSE),
('outfit_50', 'Fashion Forward', 'Wear 50 different outfits', 'outfits', 'rare', 125, 'outfits_worn', 50, 'trending-up', FALSE),
('outfit_100', 'Style Icon', 'Wear 100 different outfits', 'outfits', 'epic', 300, 'outfits_worn', 100, 'award', TRUE),
('photo_proof_1', 'Selfie Style', 'Verify your first outfit with a photo', 'outfits', 'common', 25, 'verified_outfits', 1, 'camera', FALSE),
('photo_proof_10', 'Photo Journal', 'Verify 10 outfits with photos', 'outfits', 'uncommon', 75, 'verified_outfits', 10, 'image', FALSE),
('high_score', 'Perfect Pairing', 'Wear an outfit with 95+ style score', 'outfits', 'rare', 100, 'max_style_score', 95, 'trophy', FALSE),

-- Streak Achievements (7)
('streak_3', 'Getting Warmed Up', 'Maintain a 3-day streak', 'streaks', 'common', 20, 'streak_days', 3, 'flame', FALSE),
('streak_7', 'Week Warrior', 'Maintain a 7-day streak', 'streaks', 'uncommon', 50, 'streak_days', 7, 'fire', FALSE),
('streak_14', 'Fortnight Fashion', 'Maintain a 14-day streak', 'streaks', 'uncommon', 100, 'streak_days', 14, 'zap', FALSE),
('streak_30', 'Monthly Master', 'Maintain a 30-day streak', 'streaks', 'rare', 200, 'streak_days', 30, 'calendar-check', FALSE),
('streak_60', 'Style Dedication', 'Maintain a 60-day streak', 'streaks', 'epic', 400, 'streak_days', 60, 'shield', TRUE),
('streak_100', 'Century Club', 'Maintain a 100-day streak', 'streaks', 'legendary', 1000, 'streak_days', 100, 'gem', TRUE),
('streak_365', 'Year of Style', 'Maintain a 365-day streak', 'streaks', 'legendary', 2500, 'streak_days', 365, 'crown', TRUE),

-- Social Achievements (3)
('share_first', 'Social Butterfly', 'Share your first outfit', 'social', 'common', 20, 'outfits_shared', 1, 'share', FALSE),
('share_10', 'Influencer', 'Share 10 outfits', 'social', 'uncommon', 75, 'outfits_shared', 10, 'users', FALSE),
('share_25', 'Style Ambassador', 'Share 25 outfits', 'social', 'rare', 150, 'outfits_shared', 25, 'megaphone', FALSE),

-- XP/Level Achievements (5)
('xp_500', 'Rising Star', 'Earn 500 total XP', 'style', 'common', 25, 'total_xp', 500, 'star', FALSE),
('xp_1000', 'Style Apprentice', 'Earn 1,000 total XP', 'style', 'uncommon', 50, 'total_xp', 1000, 'star', FALSE),
('xp_2500', 'Fashion Student', 'Earn 2,500 total XP', 'style', 'rare', 100, 'total_xp', 2500, 'graduation-cap', FALSE),
('xp_5000', 'Style Graduate', 'Reach Style Legend status', 'style', 'epic', 250, 'total_xp', 5000, 'award', FALSE),
('daily_goal_7', 'Consistent Stylist', 'Meet daily XP goal 7 days in a row', 'style', 'uncommon', 75, 'daily_goals_streak', 7, 'target', FALSE);

-- =====================================================
-- 5. SEED DATA - DAILY CHALLENGES
-- =====================================================

INSERT INTO daily_challenges (id, name, description, challenge_type, target_value, xp_reward, difficulty, icon, is_pro_only) VALUES
-- Easy challenges (25-35 XP)
('wear_today', 'Wear an Outfit', 'Mark any outfit as worn today', 'wear_outfit', 1, 25, 'easy', 'shirt', FALSE),
('view_outfits_3', 'Explore Styles', 'View 3 generated outfits', 'view_outfits', 3, 25, 'easy', 'eye', FALSE),
('like_outfit_2', 'Show Love', 'Like 2 outfits', 'like_outfit', 2, 30, 'easy', 'heart', FALSE),
('generate_outfit', 'Get Styled', 'Generate an outfit suggestion', 'generate_outfits', 1, 25, 'easy', 'sparkles', FALSE),

-- Medium challenges (40-60 XP)
('add_item', 'Expand Wardrobe', 'Add a new item to your wardrobe', 'add_item', 1, 40, 'medium', 'plus', FALSE),
('save_outfit_2', 'Build Collection', 'Save 2 outfits to favorites', 'save_outfit', 2, 45, 'medium', 'bookmark', FALSE),
('generate_3', 'Style Explorer', 'Generate 3 outfit suggestions', 'generate_outfits', 3, 50, 'medium', 'sparkles', FALSE),
('high_score_80', 'Quality Pick', 'Wear an outfit with 80+ style score', 'style_score', 80, 60, 'medium', 'trophy', FALSE),

-- Hard challenges (75-100 XP)
('add_items_3', 'Wardrobe Boost', 'Add 3 items to your wardrobe', 'add_item', 3, 75, 'hard', 'plus-circle', FALSE),
('wear_verify', 'Photo Proof', 'Wear and verify an outfit with photo', 'verify_outfit', 1, 85, 'hard', 'camera', FALSE),
('perfect_score', 'Style Master', 'Wear an outfit with 90+ style score', 'style_score', 90, 100, 'hard', 'star', FALSE),
('wear_twice', 'Double Down', 'Wear 2 different outfits today', 'wear_outfit', 2, 90, 'hard', 'repeat', FALSE)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    challenge_type = EXCLUDED.challenge_type,
    target_value = EXCLUDED.target_value,
    xp_reward = EXCLUDED.xp_reward,
    difficulty = EXCLUDED.difficulty,
    icon = EXCLUDED.icon,
    is_pro_only = EXCLUDED.is_pro_only;

-- =====================================================
-- 6. SEED DATA - WEEKLY CHALLENGES
-- =====================================================

INSERT INTO weekly_challenges (id, name, description, challenge_type, target_value, xp_reward, icon, is_pro_only) VALUES
('weekly_wear_5', 'Week of Style', 'Wear 5 different outfits this week', 'wear_outfit', 5, 150, 'calendar', FALSE),
('weekly_add_5', 'Wardrobe Week', 'Add 5 items to your wardrobe', 'add_item', 5, 175, 'shopping-bag', FALSE),
('weekly_streak_7', 'Perfect Week', 'Maintain a 7-day streak', 'streak_days', 7, 200, 'flame', FALSE),
('weekly_generate_10', 'Style Seeker', 'Generate 10 outfit suggestions', 'generate_outfits', 10, 125, 'wand', FALSE),
('weekly_verify_3', 'Photo Journal', 'Verify 3 outfits with photos', 'verify_outfit', 3, 200, 'camera', FALSE),
('weekly_like_10', 'Engagement Star', 'Like 10 outfits this week', 'like_outfit', 10, 100, 'heart', FALSE)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    challenge_type = EXCLUDED.challenge_type,
    target_value = EXCLUDED.target_value,
    xp_reward = EXCLUDED.xp_reward,
    icon = EXCLUDED.icon,
    is_pro_only = EXCLUDED.is_pro_only;

-- =====================================================
-- 7. ROW LEVEL SECURITY
-- =====================================================

ALTER TABLE xp_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_daily_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_weekly_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_activity ENABLE ROW LEVEL SECURITY;

-- XP Transactions policies
CREATE POLICY "Users can view own XP transactions" ON xp_transactions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert XP transactions" ON xp_transactions
    FOR INSERT WITH CHECK (TRUE);

-- Levels policies (public read)
CREATE POLICY "Anyone can view levels" ON levels
    FOR SELECT USING (TRUE);

-- Daily challenges policies (public read)
CREATE POLICY "Anyone can view daily challenges" ON daily_challenges
    FOR SELECT USING (TRUE);

-- User daily challenges policies
CREATE POLICY "Users can view own daily challenges" ON user_daily_challenges
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage user daily challenges" ON user_daily_challenges
    FOR ALL USING (TRUE);

-- Weekly challenges policies (public read)
CREATE POLICY "Anyone can view weekly challenges" ON weekly_challenges
    FOR SELECT USING (TRUE);

-- User weekly challenges policies
CREATE POLICY "Users can view own weekly challenges" ON user_weekly_challenges
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage user weekly challenges" ON user_weekly_challenges
    FOR ALL USING (TRUE);

-- Daily activity policies
CREATE POLICY "Users can view own daily activity" ON daily_activity
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage daily activity" ON daily_activity
    FOR ALL USING (TRUE);

-- =====================================================
-- 8. POSTGRESQL FUNCTIONS
-- =====================================================

-- Drop existing add_user_xp if it exists (we're replacing it)
DROP FUNCTION IF EXISTS add_user_xp(UUID, INTEGER);

-- Enhanced award_xp function with logging
CREATE OR REPLACE FUNCTION award_xp(
    p_user_id UUID,
    p_amount INTEGER,
    p_source TEXT,
    p_source_id UUID DEFAULT NULL,
    p_description TEXT DEFAULT NULL
)
RETURNS TABLE (
    new_total_xp INTEGER,
    new_level INTEGER,
    level_up BOOLEAN,
    old_level INTEGER,
    daily_goal_met BOOLEAN,
    daily_xp INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_old_level INTEGER;
    v_new_level INTEGER;
    v_new_total INTEGER;
    v_daily_goal INTEGER;
    v_daily_xp INTEGER;
    v_level_up BOOLEAN := FALSE;
    v_goal_met BOOLEAN := FALSE;
    v_today DATE;
    v_user_tz TEXT;
BEGIN
    -- Get user timezone
    SELECT COALESCE(timezone, 'America/Chicago') INTO v_user_tz
    FROM user_gamification WHERE user_id = p_user_id;

    -- If user doesn't exist, create default record
    IF v_user_tz IS NULL THEN
        INSERT INTO user_gamification (user_id, total_xp, current_level, current_streak, longest_streak, streak_freezes_available, daily_goal_xp, daily_xp_earned)
        VALUES (p_user_id, 0, 1, 0, 0, 1, 20, 0);
        v_user_tz := 'America/Chicago';
    END IF;

    -- Calculate user's local date
    v_today := (NOW() AT TIME ZONE v_user_tz)::DATE;

    -- Get current state
    SELECT current_level, total_xp, daily_goal_xp, daily_xp_earned
    INTO v_old_level, v_new_total, v_daily_goal, v_daily_xp
    FROM user_gamification
    WHERE user_id = p_user_id;

    -- Add XP
    v_new_total := COALESCE(v_new_total, 0) + p_amount;
    v_daily_xp := COALESCE(v_daily_xp, 0) + p_amount;

    -- Calculate new level from levels table
    SELECT level INTO v_new_level
    FROM levels
    WHERE min_xp <= v_new_total
    AND (max_xp IS NULL OR max_xp >= v_new_total)
    ORDER BY level DESC
    LIMIT 1;

    v_new_level := COALESCE(v_new_level, 1);
    v_old_level := COALESCE(v_old_level, 1);
    v_level_up := v_new_level > v_old_level;
    v_goal_met := v_daily_xp >= COALESCE(v_daily_goal, 20);

    -- Update gamification
    UPDATE user_gamification
    SET total_xp = v_new_total,
        current_level = v_new_level,
        daily_xp_earned = v_daily_xp,
        updated_at = NOW()
    WHERE user_id = p_user_id;

    -- Log transaction
    INSERT INTO xp_transactions (user_id, amount, source, source_id, description)
    VALUES (p_user_id, p_amount, p_source, p_source_id, p_description);

    -- Update daily activity
    INSERT INTO daily_activity (user_id, activity_date, xp_earned, daily_goal_met)
    VALUES (p_user_id, v_today, p_amount, v_goal_met)
    ON CONFLICT (user_id, activity_date)
    DO UPDATE SET
        xp_earned = daily_activity.xp_earned + p_amount,
        daily_goal_met = v_goal_met,
        updated_at = NOW();

    RETURN QUERY SELECT v_new_total, v_new_level, v_level_up, v_old_level, v_goal_met, v_daily_xp;
END;
$$;

-- Streak management function
CREATE OR REPLACE FUNCTION check_and_maintain_streak(
    p_user_id UUID,
    p_action TEXT DEFAULT 'wear'
)
RETURNS TABLE (
    current_streak INTEGER,
    streak_maintained BOOLEAN,
    freeze_used BOOLEAN,
    streak_broken BOOLEAN,
    previous_streak INTEGER,
    freezes_remaining INTEGER,
    streak_freeze_earned BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_tz TEXT;
    v_today DATE;
    v_yesterday DATE;
    v_last_activity DATE;
    v_current_streak INTEGER;
    v_longest_streak INTEGER;
    v_freezes INTEGER;
    v_is_pro BOOLEAN;
    v_max_freezes INTEGER;
    v_streak_maintained BOOLEAN := FALSE;
    v_freeze_used BOOLEAN := FALSE;
    v_streak_broken BOOLEAN := FALSE;
    v_prev_streak INTEGER;
    v_freeze_earned BOOLEAN := FALSE;
BEGIN
    -- Get user data
    SELECT
        COALESCE(g.timezone, 'America/Chicago'),
        COALESCE(g.current_streak, 0),
        COALESCE(g.longest_streak, 0),
        COALESCE(g.streak_freezes_available, 1),
        g.last_streak_activity_date,
        COALESCE(s.is_pro, FALSE)
    INTO v_user_tz, v_current_streak, v_longest_streak, v_freezes, v_last_activity, v_is_pro
    FROM user_gamification g
    LEFT JOIN user_subscriptions s ON s.user_id = g.user_id
    WHERE g.user_id = p_user_id;

    -- Create gamification record if not exists
    IF v_user_tz IS NULL THEN
        INSERT INTO user_gamification (user_id, total_xp, current_level, current_streak, longest_streak, streak_freezes_available)
        VALUES (p_user_id, 0, 1, 0, 0, 1);
        v_user_tz := 'America/Chicago';
        v_current_streak := 0;
        v_longest_streak := 0;
        v_freezes := 1;
        v_is_pro := FALSE;
    END IF;

    -- Calculate dates in user's timezone
    v_today := (NOW() AT TIME ZONE v_user_tz)::DATE;
    v_yesterday := v_today - INTERVAL '1 day';
    v_max_freezes := CASE WHEN v_is_pro THEN 5 ELSE 2 END;
    v_prev_streak := v_current_streak;

    -- If action is 'wear', maintain streak
    IF p_action = 'wear' THEN
        IF v_last_activity IS NULL OR v_last_activity < v_today THEN
            -- First activity today or new day
            IF v_last_activity = v_yesterday OR v_last_activity IS NULL OR v_current_streak = 0 THEN
                -- Streak continues or starts
                v_current_streak := v_current_streak + 1;
            ELSIF v_last_activity < v_yesterday THEN
                -- Missed days - streak broken, start fresh
                v_current_streak := 1;
                v_streak_broken := TRUE;
            END IF;

            -- Update longest streak if needed
            IF v_current_streak > v_longest_streak THEN
                v_longest_streak := v_current_streak;
            END IF;

            -- Check if earned a freeze (every 7-day streak)
            IF v_current_streak > 0 AND v_current_streak % 7 = 0
               AND v_freezes < v_max_freezes THEN
                v_freezes := v_freezes + 1;
                v_freeze_earned := TRUE;
            END IF;

            v_streak_maintained := TRUE;

            -- Update database
            UPDATE user_gamification
            SET current_streak = v_current_streak,
                longest_streak = v_longest_streak,
                streak_freezes_available = v_freezes,
                last_streak_activity_date = v_today,
                streak_lost_at = NULL,
                streak_before_loss = NULL,
                updated_at = NOW()
            WHERE user_id = p_user_id;

            -- Update daily activity
            INSERT INTO daily_activity (user_id, activity_date, streak_maintained, outfits_worn)
            VALUES (p_user_id, v_today, TRUE, 1)
            ON CONFLICT (user_id, activity_date)
            DO UPDATE SET
                streak_maintained = TRUE,
                outfits_worn = daily_activity.outfits_worn + 1,
                updated_at = NOW();
        ELSE
            -- Already maintained streak today
            v_streak_maintained := TRUE;

            -- Still update outfits_worn count
            UPDATE daily_activity
            SET outfits_worn = outfits_worn + 1, updated_at = NOW()
            WHERE user_id = p_user_id AND activity_date = v_today;
        END IF;

    -- Auto-freeze check (called at midnight by cron)
    ELSIF p_action = 'auto_freeze' THEN
        IF v_last_activity IS NULL OR v_last_activity >= v_yesterday THEN
            -- Already maintained yesterday or never had activity
            v_streak_maintained := TRUE;
        ELSIF v_last_activity < v_yesterday AND v_freezes > 0 AND v_current_streak > 0 THEN
            -- Missed yesterday, use freeze
            v_freezes := v_freezes - 1;
            v_freeze_used := TRUE;

            UPDATE user_gamification
            SET streak_freezes_available = v_freezes,
                updated_at = NOW()
            WHERE user_id = p_user_id;

            -- Log freeze usage in daily_activity
            INSERT INTO daily_activity (user_id, activity_date, freeze_used)
            VALUES (p_user_id, v_yesterday, TRUE)
            ON CONFLICT (user_id, activity_date)
            DO UPDATE SET freeze_used = TRUE, updated_at = NOW();
        ELSIF v_last_activity < v_yesterday AND v_current_streak > 0 THEN
            -- No freeze available, streak broken
            v_streak_broken := TRUE;

            UPDATE user_gamification
            SET streak_lost_at = NOW(),
                streak_before_loss = v_current_streak,
                current_streak = 0,
                updated_at = NOW()
            WHERE user_id = p_user_id;

            v_current_streak := 0;
        END IF;

    -- Check action (just return current state)
    ELSIF p_action = 'check' THEN
        v_streak_maintained := (v_last_activity = v_today);
    END IF;

    RETURN QUERY SELECT
        v_current_streak,
        v_streak_maintained,
        v_freeze_used,
        v_streak_broken,
        v_prev_streak,
        v_freezes,
        v_freeze_earned;
END;
$$;

-- Generate daily challenges function
CREATE OR REPLACE FUNCTION generate_daily_challenges(p_user_id UUID)
RETURNS SETOF user_daily_challenges
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_tz TEXT;
    v_today DATE;
    v_is_pro BOOLEAN;
    v_challenge RECORD;
    v_count INTEGER := 0;
BEGIN
    -- Get user info
    SELECT COALESCE(g.timezone, 'America/Chicago'), COALESCE(s.is_pro, FALSE)
    INTO v_user_tz, v_is_pro
    FROM user_gamification g
    LEFT JOIN user_subscriptions s ON s.user_id = g.user_id
    WHERE g.user_id = p_user_id;

    -- Create gamification record if not exists
    IF v_user_tz IS NULL THEN
        INSERT INTO user_gamification (user_id)
        VALUES (p_user_id)
        ON CONFLICT (user_id) DO NOTHING;
        v_user_tz := 'America/Chicago';
        v_is_pro := FALSE;
    END IF;

    v_today := (NOW() AT TIME ZONE v_user_tz)::DATE;

    -- Check if already generated today
    SELECT COUNT(*) INTO v_count
    FROM user_daily_challenges
    WHERE user_id = p_user_id AND challenge_date = v_today;

    IF v_count >= 3 THEN
        -- Return existing challenges
        RETURN QUERY SELECT * FROM user_daily_challenges
        WHERE user_id = p_user_id AND challenge_date = v_today
        ORDER BY
            CASE
                WHEN challenge_id IN (SELECT id FROM daily_challenges WHERE difficulty = 'easy') THEN 1
                WHEN challenge_id IN (SELECT id FROM daily_challenges WHERE difficulty = 'medium') THEN 2
                ELSE 3
            END;
        RETURN;
    END IF;

    -- Delete any partial challenges for today (shouldn't happen, but safety)
    DELETE FROM user_daily_challenges
    WHERE user_id = p_user_id AND challenge_date = v_today;

    -- Select 1 easy challenge
    FOR v_challenge IN
        SELECT * FROM daily_challenges
        WHERE active = TRUE AND difficulty = 'easy'
        AND (is_pro_only = FALSE OR v_is_pro)
        ORDER BY RANDOM() LIMIT 1
    LOOP
        INSERT INTO user_daily_challenges (
            user_id, challenge_id, challenge_date, target, xp_reward
        ) VALUES (
            p_user_id, v_challenge.id, v_today, v_challenge.target_value, v_challenge.xp_reward
        );
    END LOOP;

    -- Select 1 medium challenge
    FOR v_challenge IN
        SELECT * FROM daily_challenges
        WHERE active = TRUE AND difficulty = 'medium'
        AND (is_pro_only = FALSE OR v_is_pro)
        ORDER BY RANDOM() LIMIT 1
    LOOP
        INSERT INTO user_daily_challenges (
            user_id, challenge_id, challenge_date, target, xp_reward
        ) VALUES (
            p_user_id, v_challenge.id, v_today, v_challenge.target_value, v_challenge.xp_reward
        );
    END LOOP;

    -- Select 1 hard challenge
    FOR v_challenge IN
        SELECT * FROM daily_challenges
        WHERE active = TRUE AND difficulty = 'hard'
        AND (is_pro_only = FALSE OR v_is_pro)
        ORDER BY RANDOM() LIMIT 1
    LOOP
        INSERT INTO user_daily_challenges (
            user_id, challenge_id, challenge_date, target, xp_reward
        ) VALUES (
            p_user_id, v_challenge.id, v_today, v_challenge.target_value, v_challenge.xp_reward
        );
    END LOOP;

    RETURN QUERY SELECT * FROM user_daily_challenges
    WHERE user_id = p_user_id AND challenge_date = v_today
    ORDER BY
        CASE
            WHEN challenge_id IN (SELECT id FROM daily_challenges WHERE difficulty = 'easy') THEN 1
            WHEN challenge_id IN (SELECT id FROM daily_challenges WHERE difficulty = 'medium') THEN 2
            ELSE 3
        END;
END;
$$;

-- Generate weekly challenge function
CREATE OR REPLACE FUNCTION generate_weekly_challenge(p_user_id UUID)
RETURNS SETOF user_weekly_challenges
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_tz TEXT;
    v_today DATE;
    v_week_start DATE;
    v_is_pro BOOLEAN;
    v_challenge RECORD;
    v_count INTEGER := 0;
BEGIN
    -- Get user info
    SELECT COALESCE(g.timezone, 'America/Chicago'), COALESCE(s.is_pro, FALSE)
    INTO v_user_tz, v_is_pro
    FROM user_gamification g
    LEFT JOIN user_subscriptions s ON s.user_id = g.user_id
    WHERE g.user_id = p_user_id;

    IF v_user_tz IS NULL THEN
        v_user_tz := 'America/Chicago';
        v_is_pro := FALSE;
    END IF;

    v_today := (NOW() AT TIME ZONE v_user_tz)::DATE;
    -- Week starts on Monday
    v_week_start := v_today - (EXTRACT(ISODOW FROM v_today)::INTEGER - 1);

    -- Check if already generated this week
    SELECT COUNT(*) INTO v_count
    FROM user_weekly_challenges
    WHERE user_id = p_user_id AND week_start = v_week_start;

    IF v_count > 0 THEN
        RETURN QUERY SELECT * FROM user_weekly_challenges
        WHERE user_id = p_user_id AND week_start = v_week_start;
        RETURN;
    END IF;

    -- Select 1 random weekly challenge
    FOR v_challenge IN
        SELECT * FROM weekly_challenges
        WHERE active = TRUE
        AND (is_pro_only = FALSE OR v_is_pro)
        ORDER BY RANDOM() LIMIT 1
    LOOP
        INSERT INTO user_weekly_challenges (
            user_id, challenge_id, week_start, target, xp_reward
        ) VALUES (
            p_user_id, v_challenge.id, v_week_start, v_challenge.target_value, v_challenge.xp_reward
        );
    END LOOP;

    RETURN QUERY SELECT * FROM user_weekly_challenges
    WHERE user_id = p_user_id AND week_start = v_week_start;
END;
$$;

-- Update challenge progress function
CREATE OR REPLACE FUNCTION update_challenge_progress(
    p_user_id UUID,
    p_challenge_type TEXT,
    p_increment INTEGER DEFAULT 1,
    p_value INTEGER DEFAULT NULL
)
RETURNS TABLE (
    challenge_id TEXT,
    new_progress INTEGER,
    target INTEGER,
    is_completed BOOLEAN,
    xp_reward INTEGER,
    is_daily BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_tz TEXT;
    v_today DATE;
    v_week_start DATE;
BEGIN
    -- Get user timezone
    SELECT COALESCE(timezone, 'America/Chicago') INTO v_user_tz
    FROM user_gamification WHERE user_id = p_user_id;

    v_user_tz := COALESCE(v_user_tz, 'America/Chicago');
    v_today := (NOW() AT TIME ZONE v_user_tz)::DATE;
    v_week_start := v_today - (EXTRACT(ISODOW FROM v_today)::INTEGER - 1);

    -- Update daily challenges
    UPDATE user_daily_challenges udc
    SET progress = CASE
            WHEN p_value IS NOT NULL THEN GREATEST(udc.progress, p_value)
            ELSE udc.progress + p_increment
        END,
        is_completed = CASE
            WHEN p_value IS NOT NULL THEN p_value >= udc.target
            ELSE (udc.progress + p_increment) >= udc.target
        END,
        completed_at = CASE
            WHEN NOT udc.is_completed AND (
                (p_value IS NOT NULL AND p_value >= udc.target) OR
                (p_value IS NULL AND (udc.progress + p_increment) >= udc.target)
            ) THEN NOW()
            ELSE udc.completed_at
        END
    FROM daily_challenges dc
    WHERE udc.challenge_id = dc.id
    AND udc.user_id = p_user_id
    AND udc.challenge_date = v_today
    AND dc.challenge_type = p_challenge_type
    AND udc.is_claimed = FALSE;

    -- Update weekly challenges
    UPDATE user_weekly_challenges uwc
    SET progress = CASE
            WHEN p_value IS NOT NULL THEN GREATEST(uwc.progress, p_value)
            ELSE uwc.progress + p_increment
        END,
        is_completed = CASE
            WHEN p_value IS NOT NULL THEN p_value >= uwc.target
            ELSE (uwc.progress + p_increment) >= uwc.target
        END,
        completed_at = CASE
            WHEN NOT uwc.is_completed AND (
                (p_value IS NOT NULL AND p_value >= uwc.target) OR
                (p_value IS NULL AND (uwc.progress + p_increment) >= uwc.target)
            ) THEN NOW()
            ELSE uwc.completed_at
        END
    FROM weekly_challenges wc
    WHERE uwc.challenge_id = wc.id
    AND uwc.user_id = p_user_id
    AND uwc.week_start = v_week_start
    AND wc.challenge_type = p_challenge_type
    AND uwc.is_claimed = FALSE;

    -- Return updated daily challenges
    RETURN QUERY
    SELECT
        udc.challenge_id,
        udc.progress,
        udc.target,
        udc.is_completed,
        udc.xp_reward,
        TRUE as is_daily
    FROM user_daily_challenges udc
    JOIN daily_challenges dc ON udc.challenge_id = dc.id
    WHERE udc.user_id = p_user_id
    AND udc.challenge_date = v_today
    AND dc.challenge_type = p_challenge_type

    UNION ALL

    -- Return updated weekly challenges
    SELECT
        uwc.challenge_id,
        uwc.progress,
        uwc.target,
        uwc.is_completed,
        uwc.xp_reward,
        FALSE as is_daily
    FROM user_weekly_challenges uwc
    JOIN weekly_challenges wc ON uwc.challenge_id = wc.id
    WHERE uwc.user_id = p_user_id
    AND uwc.week_start = v_week_start
    AND wc.challenge_type = p_challenge_type;
END;
$$;

-- Check achievements function
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
    FROM wardrobe_items WHERE user_id = p_user_id AND is_archived = FALSE;

    SELECT COUNT(*) INTO v_outfit_count
    FROM outfit_history WHERE user_id = p_user_id;

    SELECT COUNT(*) INTO v_verified_count
    FROM outfit_history WHERE user_id = p_user_id AND is_verified = TRUE;

    SELECT current_streak, longest_streak, total_xp, COALESCE(total_outfits_shared, 0), COALESCE(daily_goals_streak, 0)
    INTO v_current_streak, v_longest_streak, v_total_xp, v_share_count, v_daily_goals_streak
    FROM user_gamification WHERE user_id = p_user_id;

    SELECT COUNT(DISTINCT category) INTO v_category_count
    FROM wardrobe_items WHERE user_id = p_user_id AND is_archived = FALSE AND category IS NOT NULL;

    -- Count distinct seasons (unnest the array)
    SELECT COUNT(DISTINCT s) INTO v_season_count
    FROM wardrobe_items wi, UNNEST(wi.seasons) s
    WHERE wi.user_id = p_user_id AND wi.is_archived = FALSE;

    -- Count distinct primary colors
    SELECT COUNT(DISTINCT colors->>'primary') INTO v_color_count
    FROM wardrobe_items
    WHERE user_id = p_user_id AND is_archived = FALSE AND colors->>'primary' IS NOT NULL;

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

-- =====================================================
-- 9. GRANT PERMISSIONS
-- =====================================================

GRANT ALL ON xp_transactions TO authenticated;
GRANT ALL ON xp_transactions TO service_role;

GRANT SELECT ON levels TO authenticated;
GRANT ALL ON levels TO service_role;

GRANT SELECT ON daily_challenges TO authenticated;
GRANT ALL ON daily_challenges TO service_role;

GRANT ALL ON user_daily_challenges TO authenticated;
GRANT ALL ON user_daily_challenges TO service_role;

GRANT SELECT ON weekly_challenges TO authenticated;
GRANT ALL ON weekly_challenges TO service_role;

GRANT ALL ON user_weekly_challenges TO authenticated;
GRANT ALL ON user_weekly_challenges TO service_role;

GRANT ALL ON daily_activity TO authenticated;
GRANT ALL ON daily_activity TO service_role;

-- Grant execute on functions
GRANT EXECUTE ON FUNCTION award_xp TO authenticated;
GRANT EXECUTE ON FUNCTION award_xp TO service_role;

GRANT EXECUTE ON FUNCTION check_and_maintain_streak TO authenticated;
GRANT EXECUTE ON FUNCTION check_and_maintain_streak TO service_role;

GRANT EXECUTE ON FUNCTION generate_daily_challenges TO authenticated;
GRANT EXECUTE ON FUNCTION generate_daily_challenges TO service_role;

GRANT EXECUTE ON FUNCTION generate_weekly_challenge TO authenticated;
GRANT EXECUTE ON FUNCTION generate_weekly_challenge TO service_role;

GRANT EXECUTE ON FUNCTION update_challenge_progress TO authenticated;
GRANT EXECUTE ON FUNCTION update_challenge_progress TO service_role;

GRANT EXECUTE ON FUNCTION check_achievements TO authenticated;
GRANT EXECUTE ON FUNCTION check_achievements TO service_role;

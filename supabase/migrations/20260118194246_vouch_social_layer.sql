-- =============================================================================
-- VOUCH SOCIAL LAYER - Database Migration
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. SCHOOLS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    short_name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    location TEXT,
    logo_url TEXT,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schools_slug ON schools(slug);
CREATE INDEX IF NOT EXISTS idx_schools_active ON schools(is_active) WHERE is_active = true;

COMMENT ON TABLE schools IS 'Universities/colleges for campus competition';
COMMENT ON COLUMN schools.slug IS 'URL-friendly identifier (e.g., depaul-university)';
COMMENT ON COLUMN schools.is_active IS 'Only active schools appear in app';

-- -----------------------------------------------------------------------------
-- 2. ALTER user_profiles - Add social columns
-- -----------------------------------------------------------------------------
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS school_id UUID REFERENCES schools(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS tier TEXT DEFAULT 'rookie' CHECK (tier IN ('rookie', 'seeker', 'builder', 'maven', 'icon', 'legend')),
ADD COLUMN IF NOT EXISTS tier_updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_user_profiles_school ON user_profiles(school_id) WHERE school_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_profiles_tier ON user_profiles(tier);
CREATE INDEX IF NOT EXISTS idx_user_profiles_school_tier ON user_profiles(school_id, tier) WHERE school_id IS NOT NULL;

COMMENT ON COLUMN user_profiles.school_id IS 'FK to schools table for campus competition';
COMMENT ON COLUMN user_profiles.tier IS 'Competitive tier: rookie → seeker → builder → maven → icon → legend';
COMMENT ON COLUMN user_profiles.tier_updated_at IS 'When user last changed tiers (promotion/demotion)';

-- -----------------------------------------------------------------------------
-- 3. ALTER outfit_history - Add social columns
-- -----------------------------------------------------------------------------
ALTER TABLE outfit_history
ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS vote_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS caption TEXT,
ADD COLUMN IF NOT EXISTS verification_type TEXT CHECK (verification_type IN ('photo', 'selfie', 'none'));

CREATE INDEX IF NOT EXISTS idx_outfit_history_public ON outfit_history(user_id, is_public, worn_at DESC)
    WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_outfit_history_feed ON outfit_history(worn_at DESC)
    WHERE is_public = true;

COMMENT ON COLUMN outfit_history.is_public IS 'Whether outfit appears in school feed';
COMMENT ON COLUMN outfit_history.vote_count IS 'Denormalized vote count for performance';
COMMENT ON COLUMN outfit_history.caption IS 'Optional user caption for public posts';
COMMENT ON COLUMN outfit_history.verification_type IS 'How outfit was verified: photo, selfie, or none';

-- -----------------------------------------------------------------------------
-- 4. VOTES TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS votes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    outfit_history_id UUID NOT NULL REFERENCES outfit_history(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, outfit_history_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_outfit ON votes(outfit_history_id);
CREATE INDEX IF NOT EXISTS idx_votes_user ON votes(user_id);
CREATE INDEX IF NOT EXISTS idx_votes_created ON votes(created_at DESC);

COMMENT ON TABLE votes IS 'User votes on public outfits (one vote per user per outfit)';

-- -----------------------------------------------------------------------------
-- 5. LEAGUES TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leagues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    tier TEXT NOT NULL CHECK (tier IN ('rookie', 'seeker', 'builder', 'maven', 'icon', 'legend')),
    week_start DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(school_id, tier, week_start)
);

CREATE INDEX IF NOT EXISTS idx_leagues_school_week ON leagues(school_id, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_leagues_week ON leagues(week_start DESC);

COMMENT ON TABLE leagues IS 'Weekly league instances per school and tier';

-- -----------------------------------------------------------------------------
-- 6. LEAGUE_MEMBERS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS league_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    rank INTEGER,
    votes_received INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(league_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_league_members_league ON league_members(league_id);
CREATE INDEX IF NOT EXISTS idx_league_members_user ON league_members(user_id);
CREATE INDEX IF NOT EXISTS idx_league_members_rank ON league_members(league_id, rank);

COMMENT ON TABLE league_members IS 'User participation in weekly leagues with rankings';

-- -----------------------------------------------------------------------------
-- 7. STATUS_CARDS TABLE
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS status_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    week_start DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_status_cards_user ON status_cards(user_id);
CREATE INDEX IF NOT EXISTS idx_status_cards_week ON status_cards(week_start DESC);

COMMENT ON TABLE status_cards IS 'Cached weekly status card images for sharing';

-- -----------------------------------------------------------------------------
-- 8. MATERIALIZED VIEW - Weekly Leaderboard
-- -----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW IF NOT EXISTS weekly_leaderboard AS
WITH current_week AS (
    SELECT date_trunc('week', NOW())::DATE AS week_start
),
user_stats AS (
    SELECT
        up.id AS user_id,
        up.school_id,
        up.tier,
        up.display_name,
        up.avatar_url,
        s.slug AS school_slug,
        s.name AS school_name,
        -- Vote count for current week
        COALESCE(
            (SELECT SUM(oh.vote_count)
             FROM outfit_history oh
             WHERE oh.user_id = up.id
               AND oh.is_public = true
               AND oh.worn_at >= (SELECT week_start FROM current_week)),
            0
        )::INTEGER AS weekly_votes,
        -- Post count for current week
        COALESCE(
            (SELECT COUNT(*)
             FROM outfit_history oh
             WHERE oh.user_id = up.id
               AND oh.is_public = true
               AND oh.worn_at >= (SELECT week_start FROM current_week)),
            0
        )::INTEGER AS weekly_posts,
        -- Current streak from gamification
        COALESCE(ug.current_streak, 0) AS current_streak,
        COALESCE(ug.total_xp, 0) AS total_xp
    FROM user_profiles up
    JOIN schools s ON up.school_id = s.id
    LEFT JOIN user_gamification ug ON up.id = ug.user_id
    WHERE up.school_id IS NOT NULL
      AND s.is_active = true
)
SELECT
    user_id,
    school_id,
    school_slug,
    school_name,
    tier,
    display_name,
    avatar_url,
    weekly_votes,
    weekly_posts,
    current_streak,
    total_xp,
    -- Composite score: votes weighted heavily, posts and streaks as tiebreakers
    (weekly_votes * 10 + weekly_posts * 5 + current_streak) AS score,
    RANK() OVER (
        PARTITION BY school_id, tier
        ORDER BY (weekly_votes * 10 + weekly_posts * 5 + current_streak) DESC
    ) AS rank,
    (SELECT week_start FROM current_week) AS week_start
FROM user_stats;

-- Unique index required for REFRESH MATERIALIZED VIEW CONCURRENTLY
CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_leaderboard_unique
    ON weekly_leaderboard(school_id, tier, user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_leaderboard_school_tier_rank
    ON weekly_leaderboard(school_id, tier, rank);
CREATE INDEX IF NOT EXISTS idx_weekly_leaderboard_school_slug
    ON weekly_leaderboard(school_slug);

-- -----------------------------------------------------------------------------
-- 9. RLS POLICIES
-- -----------------------------------------------------------------------------

-- Schools: Public read
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Schools are publicly readable"
    ON schools FOR SELECT
    USING (true);

-- Votes: Users manage their own votes
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all votes"
    ON votes FOR SELECT
    USING (true);

CREATE POLICY "Users can create own votes"
    ON votes FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own votes"
    ON votes FOR DELETE
    USING (auth.uid() = user_id);

-- Leagues: Public read
ALTER TABLE leagues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Leagues are publicly readable"
    ON leagues FOR SELECT
    USING (true);

-- League Members: Public read
ALTER TABLE league_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "League members are publicly readable"
    ON league_members FOR SELECT
    USING (true);

-- Status Cards: User-owned
ALTER TABLE status_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own status cards"
    ON status_cards FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own status cards"
    ON status_cards FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own status cards"
    ON status_cards FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own status cards"
    ON status_cards FOR DELETE
    USING (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 10. FUNCTIONS
-- -----------------------------------------------------------------------------

-- Increment vote count (called when vote is cast)
CREATE OR REPLACE FUNCTION increment_vote_count(outfit_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE outfit_history
    SET vote_count = vote_count + 1
    WHERE id = outfit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Decrement vote count (called when vote is removed)
CREATE OR REPLACE FUNCTION decrement_vote_count(outfit_id UUID)
RETURNS void AS $$
BEGIN
    UPDATE outfit_history
    SET vote_count = GREATEST(vote_count - 1, 0)
    WHERE id = outfit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Refresh weekly leaderboard (called by cron and on-demand)
CREATE OR REPLACE FUNCTION refresh_weekly_leaderboard()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY weekly_leaderboard;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get tier order for comparisons
CREATE OR REPLACE FUNCTION get_tier_order(tier_name TEXT)
RETURNS INTEGER AS $$
BEGIN
    RETURN CASE tier_name
        WHEN 'rookie' THEN 1
        WHEN 'seeker' THEN 2
        WHEN 'builder' THEN 3
        WHEN 'maven' THEN 4
        WHEN 'icon' THEN 5
        WHEN 'legend' THEN 6
        ELSE 0
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Promote user to next tier
CREATE OR REPLACE FUNCTION promote_user_tier(target_user_id UUID)
RETURNS TEXT AS $$
DECLARE
    current_tier TEXT;
    new_tier TEXT;
BEGIN
    SELECT tier INTO current_tier FROM user_profiles WHERE id = target_user_id;

    new_tier := CASE current_tier
        WHEN 'rookie' THEN 'seeker'
        WHEN 'seeker' THEN 'builder'
        WHEN 'builder' THEN 'maven'
        WHEN 'maven' THEN 'icon'
        WHEN 'icon' THEN 'legend'
        ELSE current_tier -- legend stays legend
    END;

    IF new_tier != current_tier THEN
        UPDATE user_profiles
        SET tier = new_tier, tier_updated_at = NOW()
        WHERE id = target_user_id;
    END IF;

    RETURN new_tier;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Demote user to previous tier
CREATE OR REPLACE FUNCTION demote_user_tier(target_user_id UUID)
RETURNS TEXT AS $$
DECLARE
    current_tier TEXT;
    new_tier TEXT;
BEGIN
    SELECT tier INTO current_tier FROM user_profiles WHERE id = target_user_id;

    new_tier := CASE current_tier
        WHEN 'legend' THEN 'icon'
        WHEN 'icon' THEN 'maven'
        WHEN 'maven' THEN 'builder'
        WHEN 'builder' THEN 'seeker'
        WHEN 'seeker' THEN 'rookie'
        ELSE current_tier -- rookie stays rookie
    END;

    IF new_tier != current_tier THEN
        UPDATE user_profiles
        SET tier = new_tier, tier_updated_at = NOW()
        WHERE id = target_user_id;
    END IF;

    RETURN new_tier;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- 11. TRIGGERS
-- -----------------------------------------------------------------------------

-- Update timestamps on schools
CREATE TRIGGER update_schools_updated_at
    BEFORE UPDATE ON schools
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Update timestamps on league_members
CREATE TRIGGER update_league_members_updated_at
    BEFORE UPDATE ON league_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- -----------------------------------------------------------------------------
-- 12. SEED DATA - Schools
-- -----------------------------------------------------------------------------
INSERT INTO schools (name, short_name, slug, location, is_active) VALUES
    ('DePaul University', 'DePaul', 'depaul', 'Chicago, IL', true),
    ('Northwestern University', 'Northwestern', 'northwestern', 'Evanston, IL', false),
    ('Loyola University Chicago', 'Loyola', 'loyola', 'Chicago, IL', false),
    ('University of Illinois Chicago', 'UIC', 'uic', 'Chicago, IL', false)
ON CONFLICT (slug) DO NOTHING;

-- Initial refresh of materialized view
SELECT refresh_weekly_leaderboard();

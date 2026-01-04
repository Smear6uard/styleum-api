-- Styleum Initial Schema
-- Enable pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- TABLES
-- ============================================================================

-- 1. User Profiles
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE,
    display_name TEXT,
    avatar_url TEXT,
    location_city TEXT,
    location_country TEXT,
    timezone TEXT DEFAULT 'America/Chicago',
    notification_time TIME DEFAULT '09:00',
    onboarding_completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. User Subscriptions
CREATE TABLE user_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    is_pro BOOLEAN DEFAULT FALSE,
    subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro')),
    subscription_platform TEXT CHECK (subscription_platform IN ('ios', 'android', 'web')),
    subscription_id TEXT,
    started_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    is_trial BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. User Gamification
CREATE TABLE user_gamification (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    total_xp INTEGER DEFAULT 0,
    current_level INTEGER DEFAULT 1 CHECK (current_level BETWEEN 1 AND 10),
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    streak_freezes_available INTEGER DEFAULT 1,
    daily_goal_xp INTEGER DEFAULT 20,
    daily_xp_earned INTEGER DEFAULT 0,
    last_active_date DATE,
    streak_lost_at TIMESTAMPTZ,
    streak_before_loss INTEGER,
    style_confidence_score NUMERIC(5,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Wardrobe Items (with embeddings)
CREATE TABLE wardrobe_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    original_image_url TEXT NOT NULL,
    processed_image_url TEXT,
    thumbnail_url TEXT,
    processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
    processing_error TEXT,
    category TEXT,
    subcategory TEXT,
    colors JSONB DEFAULT '{"primary": "unknown"}',
    pattern TEXT,
    materials TEXT[],
    occasions TEXT[],
    seasons TEXT[],
    formality_score INTEGER CHECK (formality_score BETWEEN 1 AND 10),
    style_vibes TEXT[],
    brand TEXT,
    embedding halfvec(768),
    times_worn INTEGER DEFAULT 0,
    last_worn_at TIMESTAMPTZ,
    times_suggested INTEGER DEFAULT 0,
    times_rejected INTEGER DEFAULT 0,
    is_favorite BOOLEAN DEFAULT FALSE,
    is_archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Generated Outfits (cache, expires in 24h)
CREATE TABLE generated_outfits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    item_ids UUID[] NOT NULL,
    outfit_name TEXT,
    vibe TEXT,
    reasoning TEXT,
    confidence_score NUMERIC(3,2),
    weather_temp INTEGER,
    weather_condition TEXT,
    occasion TEXT,
    mood TEXT,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
    is_worn BOOLEAN DEFAULT FALSE,
    is_saved BOOLEAN DEFAULT FALSE
);

-- 6. Outfit History (permanent record of worn outfits)
CREATE TABLE outfit_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    item_ids UUID[] NOT NULL,
    outfit_name TEXT,
    occasion TEXT,
    weather_temp INTEGER,
    weather_condition TEXT,
    confidence_score NUMERIC(3,2),
    worn_at TIMESTAMPTZ DEFAULT NOW(),
    photo_url TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    notes TEXT,
    xp_awarded INTEGER DEFAULT 10
);

-- 7. User Taste Vectors (for personalization)
CREATE TABLE user_taste_vectors (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    taste_vector halfvec(768) NOT NULL,
    dominant_vibes TEXT[],
    color_preferences JSONB,
    style_preferences JSONB,
    last_updated TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Achievements (definitions - static data)
CREATE TABLE achievements (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('wardrobe', 'outfits', 'streaks', 'social', 'style')),
    rarity TEXT NOT NULL CHECK (rarity IN ('common', 'uncommon', 'rare', 'epic', 'legendary')),
    xp_reward INTEGER NOT NULL DEFAULT 0,
    icon TEXT,
    requirement_type TEXT NOT NULL,
    requirement_value INTEGER NOT NULL,
    is_pro_only BOOLEAN DEFAULT FALSE
);

-- 9. User Achievements
CREATE TABLE user_achievements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    achievement_id TEXT REFERENCES achievements(id),
    progress INTEGER DEFAULT 0,
    is_unlocked BOOLEAN DEFAULT FALSE,
    unlocked_at TIMESTAMPTZ,
    seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, achievement_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- HNSW index for fast similarity search on embeddings
CREATE INDEX wardrobe_items_embedding_idx ON wardrobe_items
    USING hnsw (embedding halfvec_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Standard B-tree indexes
CREATE INDEX wardrobe_items_user_id_idx ON wardrobe_items(user_id);
CREATE INDEX wardrobe_items_user_archived_idx ON wardrobe_items(user_id, is_archived);
CREATE INDEX wardrobe_items_user_status_idx ON wardrobe_items(user_id, processing_status);
CREATE INDEX generated_outfits_user_id_idx ON generated_outfits(user_id);
CREATE INDEX generated_outfits_user_expires_idx ON generated_outfits(user_id, expires_at);
CREATE INDEX outfit_history_user_id_idx ON outfit_history(user_id);
CREATE INDEX outfit_history_user_worn_idx ON outfit_history(user_id, worn_at);
CREATE INDEX user_achievements_user_id_idx ON user_achievements(user_id);
CREATE INDEX user_achievements_user_unlocked_idx ON user_achievements(user_id, is_unlocked);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_gamification ENABLE ROW LEVEL SECURITY;
ALTER TABLE wardrobe_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_outfits ENABLE ROW LEVEL SECURITY;
ALTER TABLE outfit_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_taste_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;

-- User Profiles policies
CREATE POLICY "Users can view own profile" ON user_profiles
    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON user_profiles
    FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can delete own profile" ON user_profiles
    FOR DELETE USING (auth.uid() = id);

-- User Subscriptions policies
CREATE POLICY "Users can view own subscription" ON user_subscriptions
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own subscription" ON user_subscriptions
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own subscription" ON user_subscriptions
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own subscription" ON user_subscriptions
    FOR DELETE USING (auth.uid() = user_id);

-- User Gamification policies
CREATE POLICY "Users can view own gamification" ON user_gamification
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own gamification" ON user_gamification
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own gamification" ON user_gamification
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own gamification" ON user_gamification
    FOR DELETE USING (auth.uid() = user_id);

-- Wardrobe Items policies
CREATE POLICY "Users can view own items" ON wardrobe_items
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own items" ON wardrobe_items
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own items" ON wardrobe_items
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own items" ON wardrobe_items
    FOR DELETE USING (auth.uid() = user_id);

-- Generated Outfits policies
CREATE POLICY "Users can view own outfits" ON generated_outfits
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own outfits" ON generated_outfits
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own outfits" ON generated_outfits
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own outfits" ON generated_outfits
    FOR DELETE USING (auth.uid() = user_id);

-- Outfit History policies
CREATE POLICY "Users can view own history" ON outfit_history
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own history" ON outfit_history
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own history" ON outfit_history
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own history" ON outfit_history
    FOR DELETE USING (auth.uid() = user_id);

-- User Taste Vectors policies
CREATE POLICY "Users can view own taste vector" ON user_taste_vectors
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own taste vector" ON user_taste_vectors
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own taste vector" ON user_taste_vectors
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own taste vector" ON user_taste_vectors
    FOR DELETE USING (auth.uid() = user_id);

-- Achievements policies (readable by all authenticated users)
CREATE POLICY "Authenticated users can view achievements" ON achievements
    FOR SELECT USING (auth.role() = 'authenticated');

-- User Achievements policies
CREATE POLICY "Users can view own achievements" ON user_achievements
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own achievements" ON user_achievements
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own achievements" ON user_achievements
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own achievements" ON user_achievements
    FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to handle new user signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- Create user profile
    INSERT INTO public.user_profiles (id)
    VALUES (NEW.id);

    -- Create subscription record (free tier)
    INSERT INTO public.user_subscriptions (user_id)
    VALUES (NEW.id);

    -- Create gamification record
    INSERT INTO public.user_gamification (user_id)
    VALUES (NEW.id);

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at triggers
CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON user_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_user_subscriptions_updated_at
    BEFORE UPDATE ON user_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_user_gamification_updated_at
    BEFORE UPDATE ON user_gamification
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_wardrobe_items_updated_at
    BEFORE UPDATE ON wardrobe_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger to auto-create user records on signup
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================================
-- SEED DATA: Default Achievements
-- ============================================================================

INSERT INTO achievements (id, name, description, category, rarity, xp_reward, requirement_type, requirement_value) VALUES
    ('first_steps', 'First Steps', 'Upload your first item to your wardrobe', 'wardrobe', 'common', 10, 'items_uploaded', 1),
    ('wardrobe_started', 'Wardrobe Started', 'Upload 10 items to your wardrobe', 'wardrobe', 'common', 25, 'items_uploaded', 10),
    ('style_me_once', 'Style Me Once', 'Generate your first outfit', 'outfits', 'common', 15, 'outfits_generated', 1),
    ('streak_starter', 'Streak Starter', 'Maintain a 3-day streak', 'streaks', 'common', 30, 'streak_days', 3),
    ('week_warrior', 'Week Warrior', 'Maintain a 7-day streak', 'streaks', 'uncommon', 75, 'streak_days', 7),
    ('outfit_repeater', 'Outfit Repeater', 'Wear the same outfit twice', 'outfits', 'common', 20, 'outfit_repeats', 1),
    ('category_complete', 'Category Complete', 'Have at least one item in each category', 'wardrobe', 'uncommon', 50, 'categories_owned', 7),
    ('seasonal_ready', 'Seasonal Ready', 'Have items for all 4 seasons', 'wardrobe', 'uncommon', 40, 'seasons_covered', 4),
    ('photo_proof', 'Photo Proof', 'Upload your first verified outfit photo', 'outfits', 'common', 25, 'verified_outfits', 1),
    ('dedicated', 'Dedicated', 'Maintain a 30-day streak', 'streaks', 'rare', 250, 'streak_days', 30);

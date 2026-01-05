-- Fix permissions after schema reset
-- service_role needs full access to bypass RLS
-- authenticated needs CRUD access with RLS enforcement

-- ============================================================================
-- 1. GRANT SERVICE_ROLE FULL ACCESS
-- ============================================================================

-- Grant ALL on all existing tables
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Grant ALL on all existing sequences
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Grant ALL on all existing routines (functions)
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO service_role;

-- ============================================================================
-- 2. GRANT AUTHENTICATED ROLE CRUD ACCESS
-- ============================================================================

-- Grant CRUD on all existing tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;

-- Grant usage on sequences (for auto-generated IDs)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO authenticated;

-- ============================================================================
-- 3. RE-ENABLE RLS ON ALL TABLES
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

-- ============================================================================
-- 4. DROP EXISTING POLICIES (if any) AND RECREATE
-- ============================================================================

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can delete own profile" ON user_profiles;

DROP POLICY IF EXISTS "Users can view own subscription" ON user_subscriptions;
DROP POLICY IF EXISTS "Users can insert own subscription" ON user_subscriptions;
DROP POLICY IF EXISTS "Users can update own subscription" ON user_subscriptions;
DROP POLICY IF EXISTS "Users can delete own subscription" ON user_subscriptions;

DROP POLICY IF EXISTS "Users can view own gamification" ON user_gamification;
DROP POLICY IF EXISTS "Users can insert own gamification" ON user_gamification;
DROP POLICY IF EXISTS "Users can update own gamification" ON user_gamification;
DROP POLICY IF EXISTS "Users can delete own gamification" ON user_gamification;

DROP POLICY IF EXISTS "Users can view own items" ON wardrobe_items;
DROP POLICY IF EXISTS "Users can insert own items" ON wardrobe_items;
DROP POLICY IF EXISTS "Users can update own items" ON wardrobe_items;
DROP POLICY IF EXISTS "Users can delete own items" ON wardrobe_items;

DROP POLICY IF EXISTS "Users can view own outfits" ON generated_outfits;
DROP POLICY IF EXISTS "Users can insert own outfits" ON generated_outfits;
DROP POLICY IF EXISTS "Users can update own outfits" ON generated_outfits;
DROP POLICY IF EXISTS "Users can delete own outfits" ON generated_outfits;

DROP POLICY IF EXISTS "Users can view own history" ON outfit_history;
DROP POLICY IF EXISTS "Users can insert own history" ON outfit_history;
DROP POLICY IF EXISTS "Users can update own history" ON outfit_history;
DROP POLICY IF EXISTS "Users can delete own history" ON outfit_history;

DROP POLICY IF EXISTS "Users can view own taste vector" ON user_taste_vectors;
DROP POLICY IF EXISTS "Users can insert own taste vector" ON user_taste_vectors;
DROP POLICY IF EXISTS "Users can update own taste vector" ON user_taste_vectors;
DROP POLICY IF EXISTS "Users can delete own taste vector" ON user_taste_vectors;

DROP POLICY IF EXISTS "Authenticated users can view achievements" ON achievements;

DROP POLICY IF EXISTS "Users can view own achievements" ON user_achievements;
DROP POLICY IF EXISTS "Users can insert own achievements" ON user_achievements;
DROP POLICY IF EXISTS "Users can update own achievements" ON user_achievements;
DROP POLICY IF EXISTS "Users can delete own achievements" ON user_achievements;

-- ============================================================================
-- 5. CREATE RLS POLICIES
-- ============================================================================

-- user_profiles: WHERE id = auth.uid()
CREATE POLICY "Users can view own profile" ON user_profiles
    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON user_profiles
    FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON user_profiles
    FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can delete own profile" ON user_profiles
    FOR DELETE USING (auth.uid() = id);

-- user_subscriptions: WHERE user_id = auth.uid()
CREATE POLICY "Users can view own subscription" ON user_subscriptions
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own subscription" ON user_subscriptions
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own subscription" ON user_subscriptions
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own subscription" ON user_subscriptions
    FOR DELETE USING (auth.uid() = user_id);

-- user_gamification: WHERE user_id = auth.uid()
CREATE POLICY "Users can view own gamification" ON user_gamification
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own gamification" ON user_gamification
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own gamification" ON user_gamification
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own gamification" ON user_gamification
    FOR DELETE USING (auth.uid() = user_id);

-- wardrobe_items: WHERE user_id = auth.uid()
CREATE POLICY "Users can view own items" ON wardrobe_items
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own items" ON wardrobe_items
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own items" ON wardrobe_items
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own items" ON wardrobe_items
    FOR DELETE USING (auth.uid() = user_id);

-- generated_outfits: WHERE user_id = auth.uid()
CREATE POLICY "Users can view own outfits" ON generated_outfits
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own outfits" ON generated_outfits
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own outfits" ON generated_outfits
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own outfits" ON generated_outfits
    FOR DELETE USING (auth.uid() = user_id);

-- outfit_history: WHERE user_id = auth.uid()
CREATE POLICY "Users can view own history" ON outfit_history
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own history" ON outfit_history
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own history" ON outfit_history
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own history" ON outfit_history
    FOR DELETE USING (auth.uid() = user_id);

-- user_taste_vectors: WHERE user_id = auth.uid()
CREATE POLICY "Users can view own taste vector" ON user_taste_vectors
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own taste vector" ON user_taste_vectors
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own taste vector" ON user_taste_vectors
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own taste vector" ON user_taste_vectors
    FOR DELETE USING (auth.uid() = user_id);

-- achievements: SELECT only for all authenticated users (static reference data)
CREATE POLICY "Authenticated users can view achievements" ON achievements
    FOR SELECT USING (auth.role() = 'authenticated');

-- user_achievements: WHERE user_id = auth.uid()
CREATE POLICY "Users can view own achievements" ON user_achievements
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own achievements" ON user_achievements
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own achievements" ON user_achievements
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own achievements" ON user_achievements
    FOR DELETE USING (auth.uid() = user_id);

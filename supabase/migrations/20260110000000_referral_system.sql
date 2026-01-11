-- Referral System Migration
-- Creates tables for referral codes and tracking

-- ============================================================================
-- TABLES
-- ============================================================================

-- 1. Referral Codes - Unique code per user
CREATE TABLE referral_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    code TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Referrals - Tracks referral relationships
CREATE TABLE referrals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    referrer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    referee_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    code_used TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
    applied_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    referrer_reward_applied BOOLEAN DEFAULT FALSE,
    referee_reward_applied BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Fast lookup by code (case-insensitive queries use UPPER())
CREATE INDEX idx_referral_codes_code ON referral_codes(code);

-- Fast lookup by referrer for stats
CREATE INDEX idx_referrals_referrer_id ON referrals(referrer_id);

-- Fast lookup for pending referrals by referee
CREATE INDEX idx_referrals_referee_status ON referrals(referee_id, status);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

-- Referral Codes policies
CREATE POLICY "Users can view own referral code" ON referral_codes
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage referral codes" ON referral_codes
    FOR ALL USING (TRUE);

-- Referrals policies
CREATE POLICY "Users can view referrals they made or received" ON referrals
    FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = referee_id);

CREATE POLICY "Service role can manage referrals" ON referrals
    FOR ALL USING (TRUE);

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Generate unique 8-character alphanumeric referral code
-- Uses alphabet without confusing characters (no I, O, 0, 1)
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    result TEXT := '';
    i INTEGER;
BEGIN
    FOR i IN 1..8 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Create referral code for user (with collision retry)
CREATE OR REPLACE FUNCTION create_user_referral_code(p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
    new_code TEXT;
    attempts INTEGER := 0;
BEGIN
    -- Check if user already has a code
    SELECT code INTO new_code FROM referral_codes WHERE user_id = p_user_id;
    IF new_code IS NOT NULL THEN
        RETURN new_code;
    END IF;

    -- Generate unique code with retry logic
    LOOP
        new_code := generate_referral_code();
        BEGIN
            INSERT INTO referral_codes (user_id, code) VALUES (p_user_id, new_code);
            RETURN new_code;
        EXCEPTION WHEN unique_violation THEN
            attempts := attempts + 1;
            IF attempts > 10 THEN
                RAISE EXCEPTION 'Failed to generate unique referral code after 10 attempts';
            END IF;
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-create referral code when user signs up
CREATE OR REPLACE FUNCTION handle_new_user_referral_code()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM create_user_referral_code(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created_referral_code
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION handle_new_user_referral_code();

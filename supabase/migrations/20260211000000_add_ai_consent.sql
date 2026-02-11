-- Add AI consent tracking to user_profiles
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS ai_consent_given_at TIMESTAMPTZ DEFAULT NULL;

-- Create consent_log table for audit trail
CREATE TABLE IF NOT EXISTS consent_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    consent_type TEXT NOT NULL,
    agreed BOOLEAN NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_log_user_id ON consent_log(user_id);

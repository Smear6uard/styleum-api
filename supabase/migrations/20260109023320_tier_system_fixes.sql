-- Fix column naming to match existing code expectations
-- Code uses expiry_date/revenuecat_id, schema has expires_at/subscription_id

-- Rename columns to match code
ALTER TABLE user_subscriptions
  RENAME COLUMN expires_at TO expiry_date;

ALTER TABLE user_subscriptions
  RENAME COLUMN subscription_id TO revenuecat_id;

-- Add style_me_credits tracking columns to user_subscriptions
ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS style_me_credits_used INTEGER DEFAULT 0;

ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS style_me_credits_reset_at TIMESTAMPTZ DEFAULT NOW();

-- Index for efficient tier queries
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_tier
  ON user_subscriptions (subscription_tier, expiry_date);

-- Index for credit reset queries
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_credits_reset
  ON user_subscriptions (subscription_tier, style_me_credits_reset_at)
  WHERE subscription_tier = 'free';

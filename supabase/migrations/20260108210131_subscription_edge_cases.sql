-- Add grace period and billing issue tracking to user_subscriptions
ALTER TABLE user_subscriptions
  ADD COLUMN IF NOT EXISTS in_grace_period BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS grace_period_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS has_billing_issue BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS billing_issue_detected_at TIMESTAMPTZ;

-- Add tier onboarding tracking to user_profiles
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS tier_onboarding_seen_at TIMESTAMPTZ;

-- Index for grace period queries
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_grace_period
  ON user_subscriptions (in_grace_period, grace_period_expires_at)
  WHERE in_grace_period = TRUE;

-- Add pre-generation support for 4AM cron job and 9AM push notifications

-- Add flag to identify pre-generated outfits
ALTER TABLE generated_outfits
ADD COLUMN IF NOT EXISTS is_pre_generated BOOLEAN DEFAULT FALSE;

-- Add generation source tracking
ALTER TABLE generated_outfits
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'on_demand';

-- Index for faster queries on pre-generated outfits
CREATE INDEX IF NOT EXISTS idx_generated_outfits_pre_generated
ON generated_outfits (user_id, is_pre_generated, generated_at DESC);

-- Add last_active_at to user_profiles for activity tracking
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT NOW();

-- Add location columns for weather fetching during pre-generation
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS location_lat DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS location_lng DOUBLE PRECISION;

-- Add push notification columns
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS push_token TEXT,
ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS morning_notification_time TIME DEFAULT '09:00:00';

-- Index for active users query
CREATE INDEX IF NOT EXISTS idx_user_profiles_last_active
ON user_profiles (last_active_at DESC);

-- Index for push notifications
CREATE INDEX IF NOT EXISTS idx_user_profiles_push
ON user_profiles (push_enabled, push_token)
WHERE push_enabled = TRUE AND push_token IS NOT NULL;

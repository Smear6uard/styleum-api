-- Outfit Delivery System Migration
-- Adds timezone-aware push notification delivery support

-- Add push_token_updated_at to user_profiles (push_token already exists)
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS push_token_updated_at TIMESTAMPTZ;

-- Add delivered_at to generated_outfits
ALTER TABLE generated_outfits
ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

-- Index for delivery query (find undelivered pre-generated outfits)
CREATE INDEX IF NOT EXISTS idx_generated_outfits_delivery
ON generated_outfits (user_id, is_pre_generated, delivered_at)
WHERE is_pre_generated = TRUE AND delivered_at IS NULL;

-- Function to find users who should receive notifications at the current UTC hour
-- This converts each user's preferred local time to UTC and matches against current hour
CREATE OR REPLACE FUNCTION get_users_for_delivery(current_utc_hour INTEGER)
RETURNS TABLE (
  id UUID,
  push_token TEXT,
  first_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id,
    p.push_token,
    p.first_name
  FROM user_profiles p
  WHERE p.push_enabled = TRUE
    AND p.push_token IS NOT NULL
    AND p.timezone IS NOT NULL
    AND p.morning_notification_time IS NOT NULL
    -- Convert user's preferred local time to UTC hour and match
    -- Example: User in America/New_York (UTC-5) with 09:00 preference
    -- When it's 14:00 UTC, their local time is 09:00, so we notify them
    AND EXTRACT(HOUR FROM (
      p.morning_notification_time::time AT TIME ZONE p.timezone AT TIME ZONE 'UTC'
    ))::INTEGER = current_utc_hour
    -- Has undelivered pre-generated outfits from today
    AND EXISTS (
      SELECT 1 FROM generated_outfits g
      WHERE g.user_id = p.id
        AND g.is_pre_generated = TRUE
        AND g.delivered_at IS NULL
        AND DATE(g.generated_at AT TIME ZONE 'UTC') = CURRENT_DATE
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

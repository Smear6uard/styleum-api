-- Evening Confirmation Notification System
-- Allows users to confirm they styled/wore an outfit via evening push notification

-- Add evening notification preferences to user_profiles
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS evening_confirmation_enabled BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS evening_confirmation_time TIME DEFAULT '20:00:00';

-- Add index for efficient querying during cron job
CREATE INDEX IF NOT EXISTS idx_user_profiles_evening_confirmation
ON user_profiles(evening_confirmation_enabled, push_enabled)
WHERE evening_confirmation_enabled = TRUE AND push_enabled = TRUE;

-- Function to get users ready for evening confirmation
-- Called hourly by the cron job, targets users at their preferred evening time
CREATE OR REPLACE FUNCTION get_users_for_evening_confirmation(current_utc_hour INTEGER)
RETURNS TABLE (
    user_id UUID,
    push_token TEXT,
    current_streak INTEGER,
    timezone TEXT,
    first_name TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        up.id as user_id,
        up.push_token,
        COALESCE(ug.current_streak, 0) as current_streak,
        COALESCE(up.timezone, 'America/Chicago') as timezone,
        up.first_name
    FROM user_profiles up
    LEFT JOIN user_gamification ug ON up.id = ug.user_id
    WHERE up.push_enabled = TRUE
      AND up.evening_confirmation_enabled = TRUE
      AND up.push_token IS NOT NULL
      AND up.timezone IS NOT NULL
      -- Match users whose local evening confirmation time hour equals current UTC hour
      -- This converts the user's evening_confirmation_time from their timezone to UTC
      AND EXTRACT(HOUR FROM (
          (CURRENT_DATE + COALESCE(up.evening_confirmation_time, '20:00:00'::TIME))
          AT TIME ZONE COALESCE(up.timezone, 'America/Chicago')
          AT TIME ZONE 'UTC'
      ))::INTEGER = current_utc_hour
      -- Skip users who already confirmed today (already maintained streak)
      AND (
          ug.last_streak_activity_date IS NULL
          OR ug.last_streak_activity_date < CURRENT_DATE
      );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_users_for_evening_confirmation(INTEGER) TO service_role;

COMMENT ON FUNCTION get_users_for_evening_confirmation IS
'Returns users who should receive evening confirmation push notifications.
Runs hourly and targets users at their preferred evening notification time in their local timezone.
Skips users who have already confirmed/maintained their streak today.';

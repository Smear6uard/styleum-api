-- Function to get users who need streak warning at 6 PM local time
-- Called hourly by the streak-at-risk cron job
CREATE OR REPLACE FUNCTION get_users_for_streak_warning(current_utc_hour INTEGER)
RETURNS TABLE (
  id UUID,
  push_token TEXT,
  current_streak INTEGER
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    up.id,
    up.push_token,
    ug.current_streak
  FROM user_profiles up
  JOIN user_gamification ug ON up.id = ug.user_id
  WHERE up.push_enabled = TRUE
    AND up.push_token IS NOT NULL
    AND up.timezone IS NOT NULL
    AND ug.current_streak > 0
    AND (ug.last_streak_activity_date IS NULL OR ug.last_streak_activity_date < CURRENT_DATE)
    -- Match users whose local time is 18:00 (6 PM)
    AND EXTRACT(HOUR FROM (CURRENT_TIMESTAMP AT TIME ZONE up.timezone)) = 18
    AND EXTRACT(HOUR FROM (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) = current_utc_hour;
END;
$$ LANGUAGE plpgsql;

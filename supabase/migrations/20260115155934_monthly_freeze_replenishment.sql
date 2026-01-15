-- Function to replenish streak freezes monthly
-- Called by the monthly reset cron job on the 1st of each month
-- Adds +1 freeze to users below their tier max (2 free / 5 pro)
CREATE OR REPLACE FUNCTION replenish_monthly_freezes()
RETURNS JSON AS $$
DECLARE
  v_free_updated INTEGER := 0;
  v_pro_updated INTEGER := 0;
BEGIN
  -- Update free tier users (max 2 freezes)
  WITH free_users AS (
    UPDATE user_gamification ug
    SET streak_freezes_available = LEAST(streak_freezes_available + 1, 2)
    FROM user_subscriptions us
    WHERE ug.user_id = us.user_id
      AND us.subscription_tier = 'free'
      AND ug.streak_freezes_available < 2
    RETURNING ug.user_id
  )
  SELECT COUNT(*) INTO v_free_updated FROM free_users;

  -- Update pro tier users (max 5 freezes)
  WITH pro_users AS (
    UPDATE user_gamification ug
    SET streak_freezes_available = LEAST(streak_freezes_available + 1, 5)
    FROM user_subscriptions us
    WHERE ug.user_id = us.user_id
      AND us.subscription_tier = 'pro'
      AND ug.streak_freezes_available < 5
    RETURNING ug.user_id
  )
  SELECT COUNT(*) INTO v_pro_updated FROM pro_users;

  RETURN json_build_object(
    'free_users_updated', v_free_updated,
    'pro_users_updated', v_pro_updated,
    'total_updated', v_free_updated + v_pro_updated
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

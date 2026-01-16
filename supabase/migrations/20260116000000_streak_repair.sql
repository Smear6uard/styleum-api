-- Add column for tracking last streak repair to prevent double repairs
ALTER TABLE user_gamification
ADD COLUMN IF NOT EXISTS last_streak_repair_at TIMESTAMPTZ;

-- Add comment explaining the column purpose
COMMENT ON COLUMN user_gamification.last_streak_repair_at IS 'Timestamp of last streak repair to prevent multiple repairs for the same streak break';

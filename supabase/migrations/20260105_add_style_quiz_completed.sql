-- Add style_quiz_completed to user_profiles
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS style_quiz_completed BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN user_profiles.style_quiz_completed IS 'True when user completed style swipes OR did quiz later from Style Me screen';

-- Add height_category and skin_undertone columns to user_profiles
-- Both are optional - users can skip during onboarding

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS height_category TEXT CHECK (height_category IN ('short', 'average', 'tall')),
ADD COLUMN IF NOT EXISTS skin_undertone TEXT CHECK (skin_undertone IN ('warm', 'cool', 'neutral'));

-- Add comment explaining the fields
COMMENT ON COLUMN user_profiles.height_category IS 'User height category: short, average, or tall. Affects outfit silhouette recommendations.';
COMMENT ON COLUMN user_profiles.skin_undertone IS 'Skin undertone: warm, cool, or neutral. Affects color recommendations.';

-- Add missing columns to user_profiles for onboarding flow
-- These fields are sent by the Swift client during POST /api/onboarding/complete

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS first_name TEXT,
ADD COLUMN IF NOT EXISTS departments TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS body_shape TEXT,
ADD COLUMN IF NOT EXISTS favorite_brands TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS onboarding_version INTEGER DEFAULT 1;

-- Add index for querying by department
CREATE INDEX IF NOT EXISTS user_profiles_departments_idx
ON user_profiles USING GIN (departments);

-- ============================================================================
-- Onboarding Updates: Gender filtering and attribution tracking
-- ============================================================================

-- Add gender field to wardrobe_items for department filtering
ALTER TABLE wardrobe_items
ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('male', 'female', 'unisex'));

-- Default existing items to unisex (will be updated by AI tagging on new uploads)
UPDATE wardrobe_items SET gender = 'unisex' WHERE gender IS NULL;

CREATE INDEX IF NOT EXISTS idx_wardrobe_items_gender ON wardrobe_items(gender);

COMMENT ON COLUMN wardrobe_items.gender IS 'Detected gender for item: male, female, or unisex';

-- Add referral source tracking to user_profiles
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS referral_source TEXT;

COMMENT ON COLUMN user_profiles.referral_source IS 'How user heard about us: tiktok, instagram, friend, app_store, other';

-- Verify style_reference_images has gender column (should already exist from taste_vector migration)
-- If not, add it:
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'style_reference_images' AND column_name = 'gender'
  ) THEN
    ALTER TABLE style_reference_images
    ADD COLUMN gender TEXT DEFAULT 'unisex' CHECK (gender IN ('male', 'female', 'unisex'));
  END IF;
END $$;

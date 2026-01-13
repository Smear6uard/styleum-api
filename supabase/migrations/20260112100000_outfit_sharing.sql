-- ================================================
-- OUTFIT SHARING SYSTEM
-- Enables social sharing with XP farming prevention
-- ================================================

-- Track individual outfit shares (prevents XP farming)
CREATE TABLE IF NOT EXISTS outfit_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outfit_id UUID NOT NULL REFERENCES generated_outfits(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  platform TEXT, -- 'instagram_stories', 'imessage', 'twitter', 'other'

  -- One share per outfit per user
  UNIQUE(outfit_id, user_id)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS idx_outfit_shares_user ON outfit_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_outfit_shares_outfit ON outfit_shares(outfit_id);
CREATE INDEX IF NOT EXISTS idx_outfit_shares_date ON outfit_shares(shared_at DESC);

-- Ensure total_outfits_shared exists in user_gamification
ALTER TABLE user_gamification
ADD COLUMN IF NOT EXISTS total_outfits_shared INTEGER DEFAULT 0;

-- Make outfits publicly accessible by short_id (for share URLs)
ALTER TABLE generated_outfits
ADD COLUMN IF NOT EXISTS short_id TEXT UNIQUE;

-- Generate short_id for existing outfits (first 8 chars of UUID)
UPDATE generated_outfits
SET short_id = LEFT(id::text, 8)
WHERE short_id IS NULL;

-- Function to auto-generate short_id on insert
CREATE OR REPLACE FUNCTION generate_outfit_short_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.short_id IS NULL THEN
    NEW.short_id := LEFT(NEW.id::text, 8);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for auto short_id on new outfits
DROP TRIGGER IF EXISTS outfit_short_id_trigger ON generated_outfits;
CREATE TRIGGER outfit_short_id_trigger
  BEFORE INSERT ON generated_outfits
  FOR EACH ROW
  EXECUTE FUNCTION generate_outfit_short_id();

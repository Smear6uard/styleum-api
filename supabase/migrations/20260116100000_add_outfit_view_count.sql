-- ================================================
-- OUTFIT VIEW COUNT TRACKING
-- Track public views of shared outfits
-- ================================================

-- Add view_count to generated_outfits (per-outfit public views)
ALTER TABLE generated_outfits
ADD COLUMN IF NOT EXISTS public_view_count INTEGER DEFAULT 0;

-- Function to atomically increment view count
CREATE OR REPLACE FUNCTION increment_outfit_view_count(p_outfit_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE generated_outfits
  SET public_view_count = COALESCE(public_view_count, 0) + 1
  WHERE id = p_outfit_id;
END;
$$ LANGUAGE plpgsql;

-- Add fit and length columns to wardrobe_items for height-based outfit scoring
-- These attributes help recommend proportionally appropriate items based on user height

ALTER TABLE wardrobe_items
ADD COLUMN IF NOT EXISTS fit TEXT CHECK (fit IN ('oversized', 'relaxed', 'regular', 'fitted', 'slim')),
ADD COLUMN IF NOT EXISTS length TEXT CHECK (length IN ('cropped', 'regular', 'longline'));

COMMENT ON COLUMN wardrobe_items.fit IS 'Garment fit: oversized, relaxed, regular, fitted, or slim';
COMMENT ON COLUMN wardrobe_items.length IS 'Garment length: cropped, regular, or longline';

-- ============================================================================
-- Allow Photo-Only Posts in outfit_history
-- Enables direct photo posting to feed without requiring wardrobe items
-- ============================================================================

-- Allow outfit_history without wardrobe items (for direct photo posts)
ALTER TABLE outfit_history ALTER COLUMN items DROP NOT NULL;

-- Add default empty array for items column
ALTER TABLE outfit_history ALTER COLUMN items SET DEFAULT '{}';

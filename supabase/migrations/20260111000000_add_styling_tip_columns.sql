-- Add styling_tip and color_harmony_description columns to generated_outfits
-- These fields store AI-generated styling advice for each outfit

ALTER TABLE generated_outfits
ADD COLUMN IF NOT EXISTS styling_tip TEXT,
ADD COLUMN IF NOT EXISTS color_harmony_description TEXT;

-- Add comment for documentation
COMMENT ON COLUMN generated_outfits.styling_tip IS 'AI-generated styling tip for the outfit';
COMMENT ON COLUMN generated_outfits.color_harmony_description IS 'Description of why the outfit colors work together';

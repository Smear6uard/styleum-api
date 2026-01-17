-- Add target_date column to track which date the outfit is FOR
-- This decouples "when was it generated" from "when should it be shown"
-- Pre-gen runs at 11 PM UTC and generates outfits for the NEXT day

ALTER TABLE generated_outfits
ADD COLUMN target_date DATE;

-- Backfill existing pre-generated outfits with their generated_at date
UPDATE generated_outfits
SET target_date = DATE(generated_at AT TIME ZONE 'UTC')
WHERE is_pre_generated = true AND target_date IS NULL;

-- Create index for efficient querying by user + target_date
CREATE INDEX idx_generated_outfits_user_target_date
ON generated_outfits(user_id, target_date)
WHERE is_pre_generated = true;

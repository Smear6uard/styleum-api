-- Add outfit generator columns to generated_outfits table
-- This migration adds scoring columns and fixes the column naming

-- Rename item_ids to items for API consistency
ALTER TABLE generated_outfits RENAME COLUMN item_ids TO items;

-- Add new scoring columns
ALTER TABLE generated_outfits
ADD COLUMN IF NOT EXISTS style_score NUMERIC(4,2),
ADD COLUMN IF NOT EXISTS color_harmony_score NUMERIC(4,2),
ADD COLUMN IF NOT EXISTS taste_alignment_score NUMERIC(4,2),
ADD COLUMN IF NOT EXISTS weather_score NUMERIC(4,2);

-- Add index for faster queries on style score
CREATE INDEX IF NOT EXISTS generated_outfits_style_score_idx
ON generated_outfits (user_id, style_score DESC NULLS LAST);

-- Fix outfit_history table - rename item_ids to items for consistency
ALTER TABLE outfit_history RENAME COLUMN item_ids TO items;

-- Add outfit_id foreign key to outfit_history for tracking which outfit was worn
ALTER TABLE outfit_history
ADD COLUMN IF NOT EXISTS outfit_id UUID REFERENCES generated_outfits(id) ON DELETE SET NULL;

-- Create index for outfit_history by outfit_id
CREATE INDEX IF NOT EXISTS outfit_history_outfit_id_idx ON outfit_history (outfit_id);

-- Add saved_outfits table for permanently saved outfits
CREATE TABLE IF NOT EXISTS saved_outfits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    original_outfit_id UUID REFERENCES generated_outfits(id) ON DELETE SET NULL,
    items UUID[] NOT NULL,
    outfit_name TEXT,
    occasion TEXT,
    notes TEXT,
    style_score NUMERIC(4,2),
    saved_at TIMESTAMPTZ DEFAULT NOW(),
    last_worn_at TIMESTAMPTZ,
    times_worn INTEGER DEFAULT 0
);

-- RLS for saved_outfits
ALTER TABLE saved_outfits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own saved outfits" ON saved_outfits
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own saved outfits" ON saved_outfits
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own saved outfits" ON saved_outfits
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own saved outfits" ON saved_outfits
    FOR DELETE USING (auth.uid() = user_id);

-- Create index for saved_outfits
CREATE INDEX IF NOT EXISTS saved_outfits_user_id_idx ON saved_outfits (user_id);
CREATE INDEX IF NOT EXISTS saved_outfits_user_saved_at_idx ON saved_outfits (user_id, saved_at DESC);

-- Create item_name column on wardrobe_items if missing
ALTER TABLE wardrobe_items
ADD COLUMN IF NOT EXISTS item_name TEXT;

-- Add RPC function for vector similarity matching with taste vector
CREATE OR REPLACE FUNCTION match_items_by_taste(
    p_user_id UUID,
    p_limit INTEGER DEFAULT 10,
    p_category TEXT DEFAULT NULL
)
RETURNS TABLE (
    id UUID,
    category TEXT,
    subcategory TEXT,
    processed_image_url TEXT,
    original_image_url TEXT,
    colors JSONB,
    formality_score INTEGER,
    seasons TEXT[],
    occasions TEXT[],
    style_vibes TEXT[],
    similarity_score FLOAT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_taste_vector halfvec(768);
BEGIN
    -- Get user's taste vector
    SELECT taste_vector INTO v_taste_vector
    FROM user_taste_vectors
    WHERE user_id = p_user_id;

    -- If no taste vector, return items ordered by created_at
    IF v_taste_vector IS NULL THEN
        RETURN QUERY
        SELECT
            wi.id,
            wi.category,
            wi.subcategory,
            wi.processed_image_url,
            wi.original_image_url,
            wi.colors,
            wi.formality_score,
            wi.seasons,
            wi.occasions,
            wi.style_vibes,
            0.5::FLOAT AS similarity_score
        FROM wardrobe_items wi
        WHERE wi.user_id = p_user_id
        AND wi.is_archived = FALSE
        AND wi.processing_status = 'completed'
        AND (p_category IS NULL OR wi.category = p_category)
        ORDER BY wi.created_at DESC
        LIMIT p_limit;
        RETURN;
    END IF;

    -- Return items ordered by cosine similarity
    RETURN QUERY
    SELECT
        wi.id,
        wi.category,
        wi.subcategory,
        wi.processed_image_url,
        wi.original_image_url,
        wi.colors,
        wi.formality_score,
        wi.seasons,
        wi.occasions,
        wi.style_vibes,
        (1 - (wi.embedding <=> v_taste_vector))::FLOAT AS similarity_score
    FROM wardrobe_items wi
    WHERE wi.user_id = p_user_id
    AND wi.is_archived = FALSE
    AND wi.processing_status = 'completed'
    AND wi.embedding IS NOT NULL
    AND (p_category IS NULL OR wi.category = p_category)
    ORDER BY wi.embedding <=> v_taste_vector
    LIMIT p_limit;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION match_items_by_taste TO authenticated;
GRANT EXECUTE ON FUNCTION match_items_by_taste TO service_role;

-- Add RPC function for incrementing times_worn on items
CREATE OR REPLACE FUNCTION increment_times_worn(
    item_id UUID,
    worn_date TIMESTAMPTZ DEFAULT NOW()
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE wardrobe_items
    SET times_worn = times_worn + 1,
        last_worn_at = worn_date
    WHERE id = item_id;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION increment_times_worn TO authenticated;
GRANT EXECUTE ON FUNCTION increment_times_worn TO service_role;

-- Add RPC function for adding XP to user
CREATE OR REPLACE FUNCTION add_user_xp(
    p_user_id UUID,
    p_xp INTEGER
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_new_total INTEGER;
    v_new_level INTEGER;
BEGIN
    -- Update XP and daily XP
    UPDATE user_gamification
    SET total_xp = total_xp + p_xp,
        daily_xp_earned = daily_xp_earned + p_xp
    WHERE user_id = p_user_id
    RETURNING total_xp INTO v_new_total;

    -- Calculate new level (every 100 XP = 1 level, max 10)
    v_new_level := LEAST(10, 1 + (v_new_total / 100));

    -- Update level if changed
    UPDATE user_gamification
    SET current_level = v_new_level
    WHERE user_id = p_user_id
    AND current_level != v_new_level;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION add_user_xp TO authenticated;
GRANT EXECUTE ON FUNCTION add_user_xp TO service_role;

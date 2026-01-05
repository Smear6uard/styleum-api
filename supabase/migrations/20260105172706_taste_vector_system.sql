-- Style reference images for onboarding swipes
CREATE TABLE style_reference_images (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    image_url TEXT NOT NULL,
    style_tags TEXT[] NOT NULL,
    vibe TEXT NOT NULL,
    gender TEXT DEFAULT 'unisex' CHECK (gender IN ('male', 'female', 'unisex')),
    season TEXT[],
    formality_score INTEGER CHECK (formality_score BETWEEN 1 AND 10),
    embedding halfvec(768),
    display_order INTEGER,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient retrieval
CREATE INDEX style_reference_images_active_order_idx
ON style_reference_images (active, display_order);

-- Add missing columns to user_taste_vectors
ALTER TABLE user_taste_vectors
ADD COLUMN IF NOT EXISTS initialized_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS interaction_count INTEGER DEFAULT 0;

-- RLS for style_reference_images (read-only for authenticated users)
ALTER TABLE style_reference_images ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view style images"
ON style_reference_images FOR SELECT
USING (auth.role() = 'authenticated');

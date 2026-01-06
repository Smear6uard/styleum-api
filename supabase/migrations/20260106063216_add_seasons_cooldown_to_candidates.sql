-- Enhanced get_outfit_candidates with season and cooldown support
-- Adds p_seasons and p_exclude_item_ids parameters for DB-level filtering

CREATE OR REPLACE FUNCTION get_outfit_candidates(
  p_user_id UUID,
  p_taste_vector halfvec(768),
  p_genders TEXT[] DEFAULT ARRAY['male', 'female', 'unisex'],
  p_limit_per_slot INT DEFAULT 10,
  p_seasons TEXT[] DEFAULT NULL,
  p_exclude_item_ids UUID[] DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  category TEXT,
  subcategory TEXT,
  colors JSONB,
  formality_score INT,
  seasons TEXT[],
  occasions TEXT[],
  style_vibes TEXT[],
  processed_image_url TEXT,
  original_image_url TEXT,
  item_name TEXT,
  pattern TEXT,
  gender TEXT,
  embedding halfvec(768),
  similarity FLOAT
) AS $$
BEGIN
  RETURN QUERY
  WITH ranked_items AS (
    SELECT
      w.id,
      w.category,
      w.subcategory,
      w.colors,
      w.formality_score,
      w.seasons,
      w.occasions,
      w.style_vibes,
      w.processed_image_url,
      w.original_image_url,
      w.item_name,
      w.pattern,
      w.gender,
      w.embedding,
      (1 - (w.embedding <=> p_taste_vector))::FLOAT AS sim,
      ROW_NUMBER() OVER (
        PARTITION BY LOWER(w.category)
        ORDER BY w.embedding <=> p_taste_vector
      ) AS rn
    FROM wardrobe_items w
    WHERE w.user_id = p_user_id
      AND w.is_archived = FALSE
      AND w.processing_status = 'completed'
      AND w.embedding IS NOT NULL
      AND w.gender = ANY(p_genders)
      -- Season filter: item seasons overlap with requested seasons, or item has no seasons set
      AND (p_seasons IS NULL OR w.seasons && p_seasons OR w.seasons IS NULL)
      -- Cooldown: exclude specific item IDs (recently worn)
      AND (p_exclude_item_ids IS NULL OR NOT (w.id = ANY(p_exclude_item_ids)))
  )
  SELECT
    r.id,
    r.category,
    r.subcategory,
    r.colors,
    r.formality_score,
    r.seasons,
    r.occasions,
    r.style_vibes,
    r.processed_image_url,
    r.original_image_url,
    r.item_name,
    r.pattern,
    r.gender,
    r.embedding,
    r.sim AS similarity
  FROM ranked_items r
  WHERE r.rn <= p_limit_per_slot;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- pgvector similarity search functions for outfit generation
-- Uses HNSW index on wardrobe_items.embedding for fast vector search

-- Function: Search wardrobe by taste vector similarity
-- Returns items sorted by similarity to user's taste vector
CREATE OR REPLACE FUNCTION search_wardrobe_by_taste(
  p_user_id UUID,
  p_taste_vector halfvec(768),
  p_limit INT DEFAULT 50,
  p_min_similarity FLOAT DEFAULT 0.0
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
    (1 - (w.embedding <=> p_taste_vector))::FLOAT AS similarity
  FROM wardrobe_items w
  WHERE w.user_id = p_user_id
    AND w.is_archived = FALSE
    AND w.processing_status = 'completed'
    AND w.embedding IS NOT NULL
    AND (1 - (w.embedding <=> p_taste_vector)) >= p_min_similarity
  ORDER BY w.embedding <=> p_taste_vector
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Get outfit candidates grouped by category
-- Returns top N items per category, sorted by taste similarity
CREATE OR REPLACE FUNCTION get_outfit_candidates(
  p_user_id UUID,
  p_taste_vector halfvec(768),
  p_genders TEXT[] DEFAULT ARRAY['male', 'female', 'unisex'],
  p_limit_per_slot INT DEFAULT 10
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

-- Grant execute permissions to authenticated users
GRANT EXECUTE ON FUNCTION search_wardrobe_by_taste TO authenticated;
GRANT EXECUTE ON FUNCTION get_outfit_candidates TO authenticated;

-- Grant execute permissions to service role
GRANT EXECUTE ON FUNCTION search_wardrobe_by_taste TO service_role;
GRANT EXECUTE ON FUNCTION get_outfit_candidates TO service_role;

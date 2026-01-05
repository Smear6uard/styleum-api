-- ============================================================================
-- Outfit Verification Storage Bucket
-- Storage for user-uploaded photos to verify outfit wearing
-- ============================================================================

-- Create the outfit-verifications storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'outfit-verifications',
  'outfit-verifications',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================================================
-- RLS Policies for outfit-verifications bucket
-- ============================================================================

-- Users can upload verification photos to their own folder
CREATE POLICY "Users can upload their own verification photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'outfit-verifications'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Service role can upload verification photos (for API uploads)
CREATE POLICY "Service role can upload verification photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'outfit-verifications'
  AND auth.role() = 'service_role'
);

-- Verification photos are publicly readable (for display in app)
CREATE POLICY "Verification photos are publicly readable"
ON storage.objects FOR SELECT
USING (bucket_id = 'outfit-verifications');

-- Users can delete their own verification photos
CREATE POLICY "Users can delete their own verification photos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'outfit-verifications'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- ============================================================================
-- Add is_verified column to outfit_history if not exists
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'outfit_history' AND column_name = 'is_verified'
  ) THEN
    ALTER TABLE outfit_history ADD COLUMN is_verified BOOLEAN DEFAULT false;
  END IF;
END $$;

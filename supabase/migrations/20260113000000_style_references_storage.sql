-- ============================================================================
-- Style References Storage Bucket
-- Storage for onboarding style reference images
-- ============================================================================

-- Create style-references storage bucket (public read)
INSERT INTO storage.buckets (id, name, public)
VALUES ('style-references', 'style-references', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- RLS Policies for style-references bucket
-- ============================================================================

-- Public read policy (anyone can view style images)
CREATE POLICY "Public read for style-references"
ON storage.objects FOR SELECT
USING (bucket_id = 'style-references');

-- Service role upload policy (for seeding script)
CREATE POLICY "Service role upload for style-references"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'style-references');

-- Service role update policy (for upsert)
CREATE POLICY "Service role update for style-references"
ON storage.objects FOR UPDATE
USING (bucket_id = 'style-references');

-- Create bucket for processed images (background removed)
INSERT INTO storage.buckets (id, name, public)
VALUES ('wardrobe-items', 'wardrobe-items', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to read processed images
CREATE POLICY "Public read access for wardrobe-items"
ON storage.objects FOR SELECT
USING (bucket_id = 'wardrobe-items');

-- Allow service role to upload processed images
CREATE POLICY "Service role upload for wardrobe-items"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'wardrobe-items');

-- Allow service role to update processed images
CREATE POLICY "Service role update for wardrobe-items"
ON storage.objects FOR UPDATE
USING (bucket_id = 'wardrobe-items');

-- Allow service role to delete processed images
CREATE POLICY "Service role delete for wardrobe-items"
ON storage.objects FOR DELETE
USING (bucket_id = 'wardrobe-items');

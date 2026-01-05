-- Styleum: Seed Style Reference Images for Onboarding
-- These images are from Unsplash (free for commercial use, no attribution required)
--
-- Total: 44 images (22 female, 22 male)
-- Style vibes covered: minimalist, streetwear, classic, edgy, bohemian, preppy, romantic, sporty

-- ============================================
-- WOMENSWEAR STYLE REFERENCE IMAGES (22)
-- ============================================

INSERT INTO style_reference_images (image_url, style_tags, vibe, gender, season, formality_score, display_order, active) VALUES

-- Minimalist / Quiet Luxury
('https://images.unsplash.com/photo-1581044777550-4cfa60707c03?w=800&q=80',
 ARRAY['minimalist', 'neutral', 'tailored', 'clean'],
 'Quiet Luxury', 'female', ARRAY['spring', 'fall'], 7, 1, true),

('https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=800&q=80',
 ARRAY['minimalist', 'monochrome', 'sophisticated', 'sleek'],
 'Minimalist', 'female', ARRAY['spring', 'summer', 'fall'], 6, 2, true),

('https://images.unsplash.com/photo-1485968579580-b6d095142e6e?w=800&q=80',
 ARRAY['minimalist', 'neutral', 'effortless', 'modern'],
 'Quiet Luxury', 'female', ARRAY['spring', 'fall'], 5, 3, true),

-- Classic / Timeless
('https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=800&q=80',
 ARRAY['classic', 'tailored', 'professional', 'elegant'],
 'Classic', 'female', ARRAY['fall', 'winter', 'spring'], 8, 4, true),

('https://images.unsplash.com/photo-1487222477894-8943e31ef7b2?w=800&q=80',
 ARRAY['classic', 'feminine', 'polished', 'refined'],
 'Classic', 'female', ARRAY['spring', 'summer'], 7, 5, true),

('https://images.unsplash.com/photo-1496747611176-843222e1e57c?w=800&q=80',
 ARRAY['classic', 'elegant', 'timeless', 'chic'],
 'Timeless', 'female', ARRAY['spring', 'summer', 'fall'], 6, 6, true),

-- Streetwear / Urban
('https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800&q=80',
 ARRAY['streetwear', 'urban', 'bold', 'contemporary'],
 'Streetwear', 'female', ARRAY['spring', 'summer', 'fall'], 3, 7, true),

('https://images.unsplash.com/photo-1509631179647-0177331693ae?w=800&q=80',
 ARRAY['streetwear', 'casual', 'cool', 'relaxed'],
 'Urban', 'female', ARRAY['summer', 'spring'], 2, 8, true),

('https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?w=800&q=80',
 ARRAY['streetwear', 'edgy', 'modern', 'statement'],
 'Streetwear', 'female', ARRAY['fall', 'spring'], 3, 9, true),

-- Edgy / Bold
('https://images.unsplash.com/photo-1529139574466-a303027c1d8b?w=800&q=80',
 ARRAY['edgy', 'bold', 'fashion-forward', 'dramatic'],
 'Edgy', 'female', ARRAY['fall', 'winter'], 5, 10, true),

('https://images.unsplash.com/photo-1475180098004-ca77a66827be?w=800&q=80',
 ARRAY['edgy', 'dark', 'avant-garde', 'artistic'],
 'Avant-Garde', 'female', ARRAY['fall', 'winter'], 6, 11, true),

-- Bohemian / Free Spirit
('https://images.unsplash.com/photo-1518577915332-c2a19f149a75?w=800&q=80',
 ARRAY['bohemian', 'flowy', 'romantic', 'earthy'],
 'Bohemian', 'female', ARRAY['spring', 'summer'], 4, 12, true),

('https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=800&q=80',
 ARRAY['bohemian', 'natural', 'relaxed', 'artistic'],
 'Free Spirit', 'female', ARRAY['summer', 'spring'], 3, 13, true),

-- Romantic / Feminine
('https://images.unsplash.com/photo-1502716119720-b23a93e5fe1b?w=800&q=80',
 ARRAY['romantic', 'feminine', 'soft', 'delicate'],
 'Romantic', 'female', ARRAY['spring', 'summer'], 6, 14, true),

('https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=800&q=80',
 ARRAY['romantic', 'elegant', 'graceful', 'refined'],
 'Feminine', 'female', ARRAY['spring', 'summer', 'fall'], 7, 15, true),

-- Preppy / Collegiate
('https://images.unsplash.com/photo-1434389677669-e08b4cac3105?w=800&q=80',
 ARRAY['preppy', 'polished', 'classic', 'put-together'],
 'Preppy', 'female', ARRAY['fall', 'spring'], 6, 16, true),

('https://images.unsplash.com/photo-1485462537746-965f33f7f6a7?w=800&q=80',
 ARRAY['preppy', 'clean', 'collegiate', 'smart'],
 'Collegiate', 'female', ARRAY['fall', 'winter', 'spring'], 5, 17, true),

-- Sporty / Athleisure
('https://images.unsplash.com/photo-1538805060514-97d9cc17730c?w=800&q=80',
 ARRAY['sporty', 'athleisure', 'active', 'comfortable'],
 'Athleisure', 'female', ARRAY['spring', 'summer', 'fall', 'winter'], 2, 18, true),

('https://images.unsplash.com/photo-1518310383802-640c2de311b2?w=800&q=80',
 ARRAY['sporty', 'casual', 'effortless', 'modern'],
 'Sporty', 'female', ARRAY['summer', 'spring'], 2, 19, true),

-- Statement / Fashion Forward
('https://images.unsplash.com/photo-1495385794356-15371f348c31?w=800&q=80',
 ARRAY['statement', 'colorful', 'bold', 'expressive'],
 'Statement', 'female', ARRAY['spring', 'summer'], 5, 20, true),

('https://images.unsplash.com/photo-1483985988355-763728e1935b?w=800&q=80',
 ARRAY['chic', 'fashion-forward', 'trendy', 'stylish'],
 'Fashion Forward', 'female', ARRAY['fall', 'winter', 'spring'], 6, 21, true),

-- Casual Elevated
('https://images.unsplash.com/photo-1485231183945-fff4b26b5390?w=800&q=80',
 ARRAY['casual', 'elevated', 'effortless', 'cool'],
 'Casual Chic', 'female', ARRAY['spring', 'summer', 'fall'], 4, 22, true),


-- ============================================
-- MENSWEAR STYLE REFERENCE IMAGES (22)
-- ============================================

-- Minimalist / Quiet Luxury
('https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80',
 ARRAY['minimalist', 'clean', 'sophisticated', 'modern'],
 'Quiet Luxury', 'male', ARRAY['spring', 'fall'], 7, 23, true),

('https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=800&q=80',
 ARRAY['minimalist', 'tailored', 'sleek', 'refined'],
 'Minimalist', 'male', ARRAY['fall', 'winter', 'spring'], 8, 24, true),

('https://images.unsplash.com/photo-1480429370612-2b2244e63e99?w=800&q=80',
 ARRAY['minimalist', 'neutral', 'understated', 'elegant'],
 'Quiet Luxury', 'male', ARRAY['spring', 'summer', 'fall'], 6, 25, true),

-- Classic / Tailored
('https://images.unsplash.com/photo-1617137968427-85924c800a22?w=800&q=80',
 ARRAY['classic', 'tailored', 'professional', 'sharp'],
 'Classic', 'male', ARRAY['fall', 'winter', 'spring'], 9, 26, true),

('https://images.unsplash.com/photo-1593030761757-71fae45fa0e7?w=800&q=80',
 ARRAY['classic', 'smart', 'refined', 'timeless'],
 'Timeless', 'male', ARRAY['spring', 'fall', 'winter'], 8, 27, true),

('https://images.unsplash.com/photo-1552374196-c4e7ffc6e126?w=800&q=80',
 ARRAY['classic', 'polished', 'elegant', 'sophisticated'],
 'Classic', 'male', ARRAY['fall', 'winter'], 7, 28, true),

-- Streetwear / Urban
('https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=800&q=80',
 ARRAY['streetwear', 'urban', 'casual', 'cool'],
 'Streetwear', 'male', ARRAY['spring', 'summer', 'fall'], 3, 29, true),

('https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=800&q=80',
 ARRAY['streetwear', 'bold', 'contemporary', 'statement'],
 'Urban', 'male', ARRAY['summer', 'spring'], 2, 30, true),

('https://images.unsplash.com/photo-1516826957135-700dedea698c?w=800&q=80',
 ARRAY['streetwear', 'relaxed', 'modern', 'effortless'],
 'Streetwear', 'male', ARRAY['fall', 'spring', 'summer'], 3, 31, true),

-- Edgy / Bold
('https://images.unsplash.com/photo-1492447166138-50c3889fccb1?w=800&q=80',
 ARRAY['edgy', 'dark', 'bold', 'avant-garde'],
 'Edgy', 'male', ARRAY['fall', 'winter'], 5, 32, true),

('https://images.unsplash.com/photo-1495366691023-cc4eadcc2d7e?w=800&q=80',
 ARRAY['edgy', 'statement', 'fashion-forward', 'artistic'],
 'Avant-Garde', 'male', ARRAY['fall', 'winter', 'spring'], 6, 33, true),

-- Preppy / Smart Casual
('https://images.unsplash.com/photo-1488161628813-04466f0016e4?w=800&q=80',
 ARRAY['preppy', 'smart-casual', 'polished', 'clean'],
 'Preppy', 'male', ARRAY['spring', 'fall'], 6, 34, true),

('https://images.unsplash.com/photo-1504257432389-52343af06ae3?w=800&q=80',
 ARRAY['preppy', 'collegiate', 'classic', 'refined'],
 'Collegiate', 'male', ARRAY['fall', 'winter', 'spring'], 5, 35, true),

-- Sporty / Athleisure
('https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=800&q=80',
 ARRAY['sporty', 'athletic', 'active', 'fit'],
 'Athletic', 'male', ARRAY['spring', 'summer', 'fall', 'winter'], 2, 36, true),

('https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&q=80',
 ARRAY['sporty', 'athleisure', 'casual', 'comfortable'],
 'Athleisure', 'male', ARRAY['summer', 'spring'], 2, 37, true),

-- Casual / Laid Back
('https://images.unsplash.com/photo-1507680434567-5739c80be1ac?w=800&q=80',
 ARRAY['casual', 'relaxed', 'effortless', 'cool'],
 'Laid Back', 'male', ARRAY['spring', 'summer'], 3, 38, true),

('https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=800&q=80',
 ARRAY['casual', 'simple', 'clean', 'modern'],
 'Casual', 'male', ARRAY['summer', 'spring', 'fall'], 3, 39, true),

-- Rugged / Workwear
('https://images.unsplash.com/photo-1520367445093-50dc08a59d9d?w=800&q=80',
 ARRAY['rugged', 'workwear', 'heritage', 'masculine'],
 'Workwear', 'male', ARRAY['fall', 'winter'], 4, 40, true),

('https://images.unsplash.com/photo-1484516396415-5d639e76c834?w=800&q=80',
 ARRAY['rugged', 'outdoorsy', 'practical', 'durable'],
 'Heritage', 'male', ARRAY['fall', 'winter', 'spring'], 4, 41, true),

-- Smart Casual / Business Casual
('https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=800&q=80',
 ARRAY['smart-casual', 'professional', 'approachable', 'modern'],
 'Smart Casual', 'male', ARRAY['spring', 'fall', 'winter'], 6, 42, true),

('https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=800&q=80',
 ARRAY['smart-casual', 'confident', 'polished', 'contemporary'],
 'Business Casual', 'male', ARRAY['spring', 'summer', 'fall'], 6, 43, true),

-- Eclectic / Artistic
('https://images.unsplash.com/photo-1508341591423-4347099e1f19?w=800&q=80',
 ARRAY['eclectic', 'artistic', 'creative', 'unique'],
 'Eclectic', 'male', ARRAY['spring', 'summer', 'fall'], 4, 44, true);

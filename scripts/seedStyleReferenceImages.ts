import { supabaseAdmin } from "../src/services/supabase.js";
import { generateEmbedding } from "../src/services/ai/embeddings.js";
import * as fs from "fs";
import * as path from "path";

// Image metadata from spec
const STYLE_IMAGES = [
  // MENSWEAR (12)
  { filename: "Menimage1.jpg", gender: "male", vibe: "skater_casual", style_tags: ["graphic tee", "relaxed", "skatewear", "vans"], formality_score: 2, season: ["spring", "summer", "fall"] },
  { filename: "Menimage2.jpg", gender: "male", vibe: "bold_statement", style_tags: ["runway", "glitter", "editorial", "statement"], formality_score: 8, season: ["fall", "winter", "spring"] },
  { filename: "Menimage3.jpeg", gender: "male", vibe: "athleisure", style_tags: ["matching set", "monochrome", "sporty", "comfortable"], formality_score: 2, season: ["spring", "summer", "fall"] },
  { filename: "Menimage4.jpg", gender: "male", vibe: "workwear_americana", style_tags: ["rugged", "earth tones", "distressed", "boots"], formality_score: 4, season: ["fall", "winter", "spring"] },
  { filename: "Menimage5.jpeg", gender: "male", vibe: "minimalist", style_tags: ["monochrome", "clean", "technical", "black"], formality_score: 3, season: ["spring", "summer", "fall", "winter"] },
  { filename: "Menimage6.webp", gender: "male", vibe: "quiet_luxury", style_tags: ["tonal", "elevated", "italian", "summer knit"], formality_score: 6, season: ["spring", "summer"] },
  { filename: "Menimage7.jpg", gender: "male", vibe: "smart_casual", style_tags: ["layered", "neutral", "trench", "relaxed"], formality_score: 5, season: ["spring", "fall"] },
  { filename: "Menimage8.jpg", gender: "male", vibe: "earthy_outdoorsy", style_tags: ["hiking", "layered", "olive", "boots", "nature"], formality_score: 3, season: ["fall", "winter"] },
  { filename: "Menimage9.jpg", gender: "male", vibe: "preppy", style_tags: ["blazer", "polished", "nautical", "loafers"], formality_score: 7, season: ["spring", "summer", "fall"] },
  { filename: "Menimage10.jpg", gender: "male", vibe: "classic_menswear", style_tags: ["tailored", "plaid suit", "formal", "tie"], formality_score: 9, season: ["fall", "winter", "spring"] },
  { filename: "Menimage11.jpg", gender: "male", vibe: "techwear", style_tags: ["dark", "layered", "straps", "hardware", "avant-garde"], formality_score: 4, season: ["fall", "winter", "spring"] },
  { filename: "Menimage12.jpg", gender: "male", vibe: "streetwear", style_tags: ["oversized hoodie", "cargo", "urban", "graphic"], formality_score: 3, season: ["fall", "winter", "spring"] },

  // WOMENSWEAR (12)
  { filename: "WomenImage1.jpeg", gender: "female", vibe: "athleisure", style_tags: ["crop sweatshirt", "joggers", "cap", "sporty"], formality_score: 2, season: ["spring", "summer", "fall"] },
  { filename: "WomenImage2.jpg", gender: "female", vibe: "streetwear", style_tags: ["cargo pants", "crop top", "belt", "sneakers", "urban"], formality_score: 3, season: ["spring", "summer", "fall"] },
  { filename: "WomenImage3.jpg", gender: "female", vibe: "preppy", style_tags: ["tweed blazer", "mini skirt", "loafers", "knee socks", "parisian"], formality_score: 6, season: ["fall", "winter", "spring"] },
  { filename: "WomenImage4.jpg", gender: "female", vibe: "eclectic_maximalist", style_tags: ["yellow pants", "fuzzy jacket", "layered", "colorful"], formality_score: 5, season: ["fall", "winter"] },
  { filename: "WomenImage5.jpeg", gender: "female", vibe: "power_professional", style_tags: ["all black", "tailored coat", "turtleneck", "loafers"], formality_score: 8, season: ["fall", "winter", "spring"] },
  { filename: "WomenImage6.jpg", gender: "female", vibe: "y2k_trendy", style_tags: ["pink matching set", "crop hoodie", "coquette"], formality_score: 3, season: ["spring", "summer"] },
  { filename: "WomenImage7.png", gender: "female", vibe: "classic_feminine", style_tags: ["baby blue crop", "flare jeans", "simple", "clean"], formality_score: 4, season: ["spring", "summer"] },
  { filename: "WomenImage8.jpg", gender: "female", vibe: "romantic_cottagecore", style_tags: ["floral maxi dress", "straw hat", "pastoral"], formality_score: 5, season: ["spring", "summer"] },
  { filename: "WomenImage9.jpeg", gender: "female", vibe: "bohemian", style_tags: ["vest", "wide leg jeans", "layered jewelry", "artsy"], formality_score: 4, season: ["spring", "summer", "fall"] },
  { filename: "WomenImage10.jpeg", gender: "female", vibe: "edgy_grunge", style_tags: ["band tee", "sheer tights", "moto boots", "dark"], formality_score: 4, season: ["fall", "winter", "spring"] },
  { filename: "WomenImage11.png", gender: "female", vibe: "minimalist", style_tags: ["gray monochrome", "cardigan", "wide leg", "clean"], formality_score: 5, season: ["fall", "winter", "spring"] },
  { filename: "WomenImage12.jpg", gender: "female", vibe: "quiet_luxury", style_tags: ["cream silk set", "flowy", "elegant", "elevated"], formality_score: 7, season: ["spring", "summer", "fall"] },
];

async function main() {
  console.log("=== Style Reference Images Seeding ===\n");

  // Step 1: Clear existing data
  console.log("Step 1: Clearing existing style_reference_images...");
  const { error: deleteError } = await supabaseAdmin
    .from("style_reference_images")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000"); // Delete all rows

  if (deleteError) {
    console.error("Failed to clear table:", deleteError);
    process.exit(1);
  }
  console.log("✓ Cleared existing rows\n");

  // Step 2: Process each image
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < STYLE_IMAGES.length; i++) {
    const img = STYLE_IMAGES[i];
    const folder = img.gender === "male" ? "menswear" : "womenswear";
    const localPath = path.join(
      process.cwd(),
      "src/data/onboarding-images",
      folder,
      img.filename
    );

    console.log(`[${i + 1}/${STYLE_IMAGES.length}] Processing ${img.filename}...`);

    try {
      // Read local file
      const fileBuffer = fs.readFileSync(localPath);
      const ext = path.extname(img.filename).toLowerCase();
      const contentType = ext === ".png" ? "image/png"
        : ext === ".webp" ? "image/webp"
        : "image/jpeg";

      // Upload to Supabase Storage
      const storagePath = `${folder}/${img.filename}`;
      const { error: uploadError } = await supabaseAdmin.storage
        .from("style-references")
        .upload(storagePath, fileBuffer, {
          contentType,
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      // Get public URL
      const { data: urlData } = supabaseAdmin.storage
        .from("style-references")
        .getPublicUrl(storagePath);

      const imageUrl = urlData.publicUrl;
      console.log(`  ✓ Uploaded to ${imageUrl}`);

      // Generate embedding via FashionSigLIP
      console.log(`  Generating embedding...`);
      const embedding = await generateEmbedding(imageUrl);
      console.log(`  ✓ Embedding generated (768-dim)`);

      // Insert into database
      const { error: insertError } = await supabaseAdmin
        .from("style_reference_images")
        .insert({
          image_url: imageUrl,
          vibe: img.vibe,
          gender: img.gender,
          style_tags: img.style_tags,
          formality_score: img.formality_score,
          season: img.season,
          embedding,
          display_order: i + 1,
          active: true,
        });

      if (insertError) {
        throw new Error(`Insert failed: ${insertError.message}`);
      }

      console.log(`  ✓ Inserted into database\n`);
      successCount++;

    } catch (error) {
      console.error(`  ✗ Error: ${error}\n`);
      failCount++;
    }

    // Rate limit: 2 second delay between RunPod calls
    if (i < STYLE_IMAGES.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  // Summary
  console.log("=== Summary ===");
  console.log(`Success: ${successCount}/${STYLE_IMAGES.length}`);
  console.log(`Failed: ${failCount}/${STYLE_IMAGES.length}`);

  // Verify
  const { data: verifyData } = await supabaseAdmin
    .from("style_reference_images")
    .select("id, embedding")
    .not("embedding", "is", null);

  console.log(`\nVerification: ${verifyData?.length || 0} images with embeddings`);

  if (verifyData?.length === 24) {
    console.log("✓ All 24 images seeded successfully!");
  } else {
    console.log(`⚠ Expected 24 images, got ${verifyData?.length || 0}`);
    process.exit(1);
  }
}

main().catch(console.error);

import { callRunPod } from "./runpod.js";
import { supabaseAdmin } from "../supabase.js";

const BIREFNET_ENDPOINT = process.env.RUNPOD_BIREFNET_ENDPOINT;

interface BiRefNetOutput {
  image_base64: string;
}

/**
 * Remove background from an image using BiRefNet on RunPod
 * @param imageUrl - URL of the image to process
 * @param itemId - UUID of the wardrobe item (used for storage path)
 * @returns Public URL of the processed image with transparent background
 */
export async function removeBackground(
  imageUrl: string,
  itemId: string
): Promise<string> {
  if (!BIREFNET_ENDPOINT) {
    throw new Error("RUNPOD_BIREFNET_ENDPOINT not configured");
  }

  // Call RunPod BiRefNet endpoint
  const result = await callRunPod<BiRefNetOutput>(BIREFNET_ENDPOINT, {
    image_url: imageUrl,
  });

  if (!result.image_base64) {
    throw new Error("BiRefNet did not return image_base64");
  }

  // Decode base64 to buffer
  const imageBuffer = Buffer.from(result.image_base64, "base64");

  // Upload to Supabase Storage
  const storagePath = `processed/${itemId}.png`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from("wardrobe-items")
    .upload(storagePath, imageBuffer, {
      contentType: "image/png",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Failed to upload processed image: ${uploadError.message}`);
  }

  // Get public URL
  const { data: urlData } = supabaseAdmin.storage
    .from("wardrobe-items")
    .getPublicUrl(storagePath);

  return urlData.publicUrl;
}

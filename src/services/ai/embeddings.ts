import { callRunPod } from "./runpod.js";

const FASHIONSIGLIP_ENDPOINT = process.env.RUNPOD_FASHIONSIGLIP_ENDPOINT;

interface FashionSigLIPOutput {
  embedding: number[];
}

/**
 * Generate a 768-dimensional embedding for a clothing image using FashionSigLIP
 * @param imageUrl - URL of the image to embed
 * @returns 768-dimensional embedding array
 */
export async function generateEmbedding(imageUrl: string): Promise<number[]> {
  if (!FASHIONSIGLIP_ENDPOINT) {
    throw new Error("RUNPOD_FASHIONSIGLIP_ENDPOINT not configured");
  }

  const result = await callRunPod<FashionSigLIPOutput>(FASHIONSIGLIP_ENDPOINT, {
    image_url: imageUrl,
  });

  if (!result.embedding || !Array.isArray(result.embedding)) {
    throw new Error("FashionSigLIP did not return valid embedding");
  }

  if (result.embedding.length !== 768) {
    throw new Error(
      `Expected 768-dim embedding, got ${result.embedding.length}`
    );
  }

  return result.embedding;
}

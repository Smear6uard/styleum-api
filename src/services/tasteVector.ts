import { supabaseAdmin } from "./supabase.js";

// Interaction weights from architecture spec 5.1
export const INTERACTION_WEIGHTS = {
  wear: 1.0, // User confirmed wearing outfit
  save: 0.7, // User saved outfit for later
  like: 0.5, // User liked an outfit
  skip: -0.2, // User skipped without interaction
  reject: -0.5, // User explicitly rejected outfit
  edit: 0.3, // User modified suggested outfit
} as const;

export type InteractionType = keyof typeof INTERACTION_WEIGHTS;

// Recency decay factor per day
const ALPHA = 0.95;

// Vector dimension
const VECTOR_DIM = 768;

/**
 * Initialize taste vector from onboarding swipes.
 * User swipes through 25-30 style images (Tinder-style).
 */
export async function initializeTasteVector(
  userId: string,
  likedImageIds: string[],
  dislikedImageIds: string[]
): Promise<void> {
  console.log(
    `[Taste] Initializing taste vector for user ${userId} with ${likedImageIds.length} likes, ${dislikedImageIds.length} dislikes`
  );

  // Get embeddings for liked images
  const { data: likedData } = await supabaseAdmin
    .from("style_reference_images")
    .select("embedding")
    .in("id", likedImageIds);

  // Get embeddings for disliked images
  const { data: dislikedData } = await supabaseAdmin
    .from("style_reference_images")
    .select("embedding")
    .in("id", dislikedImageIds);

  const likedEmbeddings = (likedData || [])
    .map((e) => e.embedding as number[] | null)
    .filter((e): e is number[] => e !== null);

  const dislikedEmbeddings = (dislikedData || [])
    .map((e) => e.embedding as number[] | null)
    .filter((e): e is number[] => e !== null);

  // Calculate positive direction (average of likes)
  const positive = averageVectors(likedEmbeddings);

  // Calculate negative direction (average of dislikes, subtracted)
  const negative = averageVectors(dislikedEmbeddings);

  // Initial taste vector: positive - 0.3 * negative
  const tasteVector = subtractVectors(positive, scaleVector(negative, 0.3));

  // Normalize to unit vector
  const normalized = normalizeVector(tasteVector);

  // Store in database
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from("user_taste_vectors").upsert({
    user_id: userId,
    taste_vector: normalized,
    initialized_at: now,
    last_updated: now,
    interaction_count: likedImageIds.length + dislikedImageIds.length,
  });

  if (error) {
    console.error(`[Taste] Failed to initialize taste vector:`, error);
    throw new Error(`Failed to initialize taste vector: ${error.message}`);
  }

  console.log(`[Taste] Taste vector initialized for user ${userId}`);
}

/**
 * Update taste vector based on user interaction.
 * Uses exponential moving average with decay.
 */
export async function updateTasteVector(
  userId: string,
  itemEmbedding: number[],
  interactionType: InteractionType
): Promise<void> {
  // Get current taste vector
  const { data: current } = await supabaseAdmin
    .from("user_taste_vectors")
    .select("taste_vector, last_updated, interaction_count")
    .eq("user_id", userId)
    .single();

  if (!current?.taste_vector) {
    console.warn(`[Taste] No taste vector found for user ${userId}`);
    return;
  }

  const weight = INTERACTION_WEIGHTS[interactionType];
  const currentVector = current.taste_vector as number[];

  // Calculate days since last update for decay
  const lastUpdated = new Date(current.last_updated);
  const daysSinceUpdate = Math.floor(
    (Date.now() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24)
  );
  const decay = Math.pow(ALPHA, daysSinceUpdate);

  // Learning rate decreases over time (stabilizes preferences)
  const baseRate = 0.1;
  const learningRate = baseRate * decay;

  // Update vector: new = current + learningRate * weight * (item - current)
  const difference = subtractVectors(itemEmbedding, currentVector);
  const scaledDiff = scaleVector(difference, learningRate * weight);
  const newVector = addVectors(currentVector, scaledDiff);

  // Normalize
  const normalized = normalizeVector(newVector);

  // Save updated vector
  const { error } = await supabaseAdmin
    .from("user_taste_vectors")
    .update({
      taste_vector: normalized,
      last_updated: new Date().toISOString(),
      interaction_count: (current.interaction_count || 0) + 1,
    })
    .eq("user_id", userId);

  if (error) {
    console.error(`[Taste] Failed to update taste vector:`, error);
  } else {
    console.log(
      `[Taste] Updated taste vector for user ${userId} (${interactionType}, weight=${weight})`
    );
  }
}

/**
 * Get user's taste vector.
 */
export async function getTasteVector(userId: string): Promise<number[] | null> {
  const { data } = await supabaseAdmin
    .from("user_taste_vectors")
    .select("taste_vector")
    .eq("user_id", userId)
    .single();

  return (data?.taste_vector as number[]) || null;
}

/**
 * Check if user has completed onboarding (has taste vector).
 */
export async function hasCompletedOnboarding(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("user_taste_vectors")
    .select("user_id")
    .eq("user_id", userId)
    .single();

  return !!data;
}

/**
 * Calculate cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

// Vector math utilities

function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return new Array(VECTOR_DIM).fill(0);

  const sum = vectors.reduce(
    (acc, vec) => addVectors(acc, vec),
    new Array(VECTOR_DIM).fill(0)
  );
  return scaleVector(sum, 1 / vectors.length);
}

function addVectors(a: number[], b: number[]): number[] {
  return a.map((val, i) => val + (b[i] || 0));
}

function subtractVectors(a: number[], b: number[]): number[] {
  return a.map((val, i) => val - (b[i] || 0));
}

function scaleVector(vec: number[], scalar: number): number[] {
  return vec.map((val) => val * scalar);
}

function normalizeVector(vec: number[]): number[] {
  const magnitude = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
  if (magnitude === 0) return vec;
  return vec.map((val) => val / magnitude);
}

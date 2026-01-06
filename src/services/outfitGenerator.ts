/**
 * Outfit Generator Service
 * Core logic for generating personalized outfit recommendations
 * Uses Gemini AI for intelligent outfit composition with rule-based fallback
 */

import { supabaseAdmin } from "./supabase.js";
import { getTasteVector, cosineSimilarity, updateTasteVector } from "./tasteVector.js";
import { getWeatherByCoords, getDefaultWeather, type WeatherData } from "./weather.js";
import {
  filterByWeather,
  sortBySeasonalFit,
  type ScoredItem,
  type WardrobeItem as SeasonalWardrobeItem,
} from "../utils/seasonalFilter.js";
import {
  calculateOutfitColorHarmony,
  filterByColorCompatibility,
  type ColorInfo,
} from "./colorHarmony.js";
import {
  callOpenRouterWithFallback,
  isOpenRouterAvailable,
  parseJsonFromLLMResponse,
} from "./ai/openrouter.js";

// Category slots for outfit generation
const OUTFIT_SLOTS = ["top", "bottom", "footwear"] as const;
const OPTIONAL_SLOTS = ["outerwear", "accessory"] as const;

// Category to slot mapping
const CATEGORY_TO_SLOT: Record<string, (typeof OUTFIT_SLOTS)[number] | (typeof OPTIONAL_SLOTS)[number]> = {
  "t-shirt": "top",
  "t-shirts": "top",
  shirt: "top",
  shirts: "top",
  blouse: "top",
  blouses: "top",
  top: "top",
  tops: "top",
  sweater: "top",
  sweaters: "top",
  hoodie: "top",
  hoodies: "top",
  tank: "top",
  "tank top": "top",
  polo: "top",
  polos: "top",
  cardigan: "top",
  cardigans: "top",

  pants: "bottom",
  jeans: "bottom",
  trousers: "bottom",
  shorts: "bottom",
  skirt: "bottom",
  skirts: "bottom",
  bottom: "bottom",
  bottoms: "bottom",
  leggings: "bottom",
  chinos: "bottom",
  joggers: "bottom",

  shoes: "footwear",
  sneakers: "footwear",
  boots: "footwear",
  sandals: "footwear",
  loafers: "footwear",
  heels: "footwear",
  flats: "footwear",
  footwear: "footwear",
  oxfords: "footwear",
  "dress shoes": "footwear",

  jacket: "outerwear",
  jackets: "outerwear",
  coat: "outerwear",
  coats: "outerwear",
  blazer: "outerwear",
  blazers: "outerwear",
  outerwear: "outerwear",
  vest: "outerwear",
  vests: "outerwear",
  parka: "outerwear",
  parkas: "outerwear",

  hat: "accessory",
  hats: "accessory",
  scarf: "accessory",
  scarves: "accessory",
  belt: "accessory",
  belts: "accessory",
  bag: "accessory",
  bags: "accessory",
  jewelry: "accessory",
  watch: "accessory",
  watches: "accessory",
  sunglasses: "accessory",
  accessory: "accessory",
  accessories: "accessory",
};

// Formality levels for occasions
const OCCASION_FORMALITY: Record<string, { min: number; max: number }> = {
  casual: { min: 1, max: 4 },
  "smart casual": { min: 4, max: 6 },
  business: { min: 6, max: 8 },
  formal: { min: 8, max: 10 },
  workout: { min: 1, max: 2 },
  date: { min: 4, max: 7 },
  party: { min: 4, max: 8 },
  outdoor: { min: 1, max: 5 },
  travel: { min: 2, max: 5 },
};

// Mood to style vibes mapping
const MOOD_VIBE_MAP: Record<string, string[]> = {
  confident: ["edgy", "classic", "minimalist", "bold"],
  cozy: ["casual", "bohemian", "relaxed", "oversized"],
  professional: ["classic", "minimalist", "preppy", "polished"],
  creative: ["bohemian", "streetwear", "eclectic", "artistic"],
  romantic: ["romantic", "feminine", "soft", "elegant"],
  energetic: ["sporty", "streetwear", "colorful", "bold"],
};

// ============================================================================
// TYPES
// ============================================================================

export interface WardrobeItem {
  id: string;
  category?: string | null;
  subcategory?: string | null;
  embedding?: number[] | null;
  colors?: {
    primary?: string | null;
    secondary?: string[] | null;
    accent?: string | null;
  } | null;
  formality_score?: number | null;
  seasons?: string[] | null;
  occasions?: string[] | null;
  style_vibes?: string[] | null;
  processed_image_url?: string | null;
  original_image_url?: string | null;
  item_name?: string | null;
  pattern?: string | null;
  gender?: "male" | "female" | "unisex" | null;
}

export interface GeneratedOutfit {
  items: WardrobeItem[];
  item_ids: string[];
  name: string;
  vibe: string;
  reasoning: string;
  styling_tip?: string;
  color_harmony_description?: string;
  confidence_score: number;
  style_score: number;
  color_harmony_score: number;
  taste_alignment_score: number;
  weather_score: number;
  occasion_match: boolean;
}

export interface GenerationParams {
  userId: string;
  occasion?: string;
  mood?: string;
  lat?: number;
  lon?: number;
  excludeItemIds?: string[];
  count?: number;
  constraints?: GenerationConstraints;
}

export interface GenerationConstraints {
  excludeItemIds?: string[];
  mustSwapSlots?: string[];
  minFormality?: number;
  maxFormality?: number;
  preferVibes?: string[];
  avoidColors?: boolean;
  excludeAllPreviousItems?: boolean;
}

export interface GenerateOutfitsResult {
  outfits: GeneratedOutfit[];
  weather: WeatherData;
}

// Gemini response structure
interface GeminiOutfitResponse {
  items: {
    top: string;
    bottom: string;
    footwear: string;
    outerwear?: string | null;
    accessory?: string[];
  };
  name: string;
  vibe: string;
  reasoning: string;
  styling_tip?: string;
  color_harmony?: string;
  confidence_score: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getSlotForCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  const normalized = category.toLowerCase().trim();
  return CATEGORY_TO_SLOT[normalized] || null;
}

async function getUserWardrobe(userId: string): Promise<WardrobeItem[]> {
  // Get user's department preference
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("departments")
    .eq("id", userId)
    .single();

  // Build gender filter based on department
  let genderFilter: string[] = ["unisex"]; // Always include unisex

  if (profile?.departments?.includes("menswear")) {
    genderFilter.push("male");
  }
  if (profile?.departments?.includes("womenswear")) {
    genderFilter.push("female");
  }

  // If no department set or both selected, include all
  if (!profile?.departments || profile.departments.length === 0) {
    genderFilter = ["male", "female", "unisex"];
  }

  // Fetch items filtered by gender
  const { data, error } = await supabaseAdmin
    .from("wardrobe_items")
    .select(
      "id, category, subcategory, embedding, colors, formality_score, seasons, occasions, style_vibes, processed_image_url, original_image_url, item_name, pattern, gender"
    )
    .eq("user_id", userId)
    .eq("is_archived", false)
    .eq("processing_status", "completed")
    .in("gender", genderFilter);

  if (error) {
    console.error("[OutfitGen] Failed to fetch wardrobe:", error);
    return [];
  }

  return data || [];
}

// Interface for items with pgvector similarity score
interface PgVectorCandidate extends WardrobeItem {
  similarity: number;
}

/**
 * Get user's gender filter based on department preferences
 */
async function getUserGenderFilter(userId: string): Promise<string[]> {
  const { data: profile } = await supabaseAdmin
    .from("user_profiles")
    .select("departments")
    .eq("id", userId)
    .single();

  let genderFilter: string[] = ["unisex"];

  if (profile?.departments?.includes("menswear")) {
    genderFilter.push("male");
  }
  if (profile?.departments?.includes("womenswear")) {
    genderFilter.push("female");
  }

  // If no department set or both selected, include all
  if (!profile?.departments || profile.departments.length === 0) {
    genderFilter = ["male", "female", "unisex"];
  }

  return genderFilter;
}

/**
 * Get outfit candidates using pgvector similarity search
 * Uses HNSW index for fast vector search, returns top N items per category
 * Supports season filtering and cooldown (excluding recently worn items)
 */
async function getCandidatesWithPgVector(
  userId: string,
  tasteVector: number[],
  genders: string[],
  limitPerSlot: number = 15,
  seasons: string[] | null = null,
  excludeItemIds: string[] | null = null
): Promise<PgVectorCandidate[]> {
  console.log(
    `[OutfitGen] pgvector search - genders: ${genders.join(",")}, seasons: ${seasons?.join(",") || "all"}, excluding: ${excludeItemIds?.length || 0} items`
  );

  const { data, error } = await supabaseAdmin.rpc("get_outfit_candidates", {
    p_user_id: userId,
    p_taste_vector: tasteVector,
    p_genders: genders,
    p_limit_per_slot: limitPerSlot,
    p_seasons: seasons,
    p_exclude_item_ids: excludeItemIds,
  });

  if (error) {
    console.error("[OutfitGen] pgvector RPC failed:", error);
    return [];
  }

  return (data || []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    category: row.category as string | null,
    subcategory: row.subcategory as string | null,
    colors: row.colors as WardrobeItem["colors"],
    formality_score: row.formality_score as number | null,
    seasons: row.seasons as string[] | null,
    occasions: row.occasions as string[] | null,
    style_vibes: row.style_vibes as string[] | null,
    processed_image_url: row.processed_image_url as string | null,
    original_image_url: row.original_image_url as string | null,
    item_name: row.item_name as string | null,
    pattern: row.pattern as string | null,
    gender: row.gender as WardrobeItem["gender"],
    embedding: row.embedding as number[] | null,
    similarity: row.similarity as number,
  }));
}

/**
 * Get item IDs worn in the last N days for cooldown filtering
 */
async function getRecentlyWornItemIds(userId: string, days: number = 3): Promise<string[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const { data, error } = await supabaseAdmin
    .from("outfit_history")
    .select("items")
    .eq("user_id", userId)
    .gte("worn_at", cutoffDate.toISOString());

  if (error) {
    console.error("[OutfitGen] Failed to fetch recently worn items:", error);
    return [];
  }

  // Flatten all item IDs from recent outfits and dedupe
  const allItemIds = (data || []).flatMap((row) => (row.items as string[]) || []);
  return [...new Set(allItemIds)];
}

/**
 * Map weather temperature to appropriate seasons
 */
function getSeasonsForWeather(weather: WeatherData): string[] {
  const temp = weather.temperature;
  if (temp < 5) return ["winter"];
  if (temp < 15) return ["winter", "fall"];
  if (temp < 22) return ["spring", "fall"];
  if (temp < 28) return ["spring", "summer"];
  return ["summer"];
}

function groupBySlot(items: WardrobeItem[]): Record<string, WardrobeItem[]> {
  const groups: Record<string, WardrobeItem[]> = {
    top: [],
    bottom: [],
    footwear: [],
    outerwear: [],
    accessory: [],
    unknown: [],
  };

  for (const item of items) {
    const slot = getSlotForCategory(item.category) || getSlotForCategory(item.subcategory);
    if (slot && groups[slot]) {
      groups[slot].push(item);
    } else {
      groups.unknown.push(item);
    }
  }

  return groups;
}

function scoreTasteAlignment(itemEmbedding: number[] | null, tasteVector: number[] | null): number {
  if (!itemEmbedding || !tasteVector) return 0.5;
  const similarity = cosineSimilarity(itemEmbedding, tasteVector);
  return (similarity + 1) / 2;
}

function matchesOccasion(item: WardrobeItem, occasion: string | undefined): boolean {
  if (!occasion) return true;

  const formalityRange = OCCASION_FORMALITY[occasion.toLowerCase()];
  if (!formalityRange) return true;

  const itemFormality = item.formality_score ?? 5;
  return itemFormality >= formalityRange.min && itemFormality <= formalityRange.max;
}

function getCurrentSeason(): string {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "fall";
  return "winter";
}

function filterItemsByMood(items: WardrobeItem[], mood?: string): WardrobeItem[] {
  if (!mood || !MOOD_VIBE_MAP[mood]) {
    return items;
  }

  const targetVibes = MOOD_VIBE_MAP[mood];

  return [...items].sort((a, b) => {
    const matchA = a.style_vibes?.some((v) => targetVibes.includes(v)) ? 1 : 0;
    const matchB = b.style_vibes?.some((v) => targetVibes.includes(v)) ? 1 : 0;
    return matchB - matchA;
  });
}

function applyConstraints(
  items: WardrobeItem[],
  constraints?: GenerationConstraints
): WardrobeItem[] {
  if (!constraints) return items;

  let filtered = [...items];

  if (constraints.excludeItemIds?.length) {
    filtered = filtered.filter((item) => !constraints.excludeItemIds!.includes(item.id));
  }

  if (constraints.minFormality !== undefined || constraints.maxFormality !== undefined) {
    filtered = filtered.filter((item) => {
      const formality = item.formality_score ?? 5;
      if (constraints.minFormality !== undefined && formality < constraints.minFormality) return false;
      if (constraints.maxFormality !== undefined && formality > constraints.maxFormality) return false;
      return true;
    });
  }

  if (constraints.preferVibes?.length) {
    filtered.sort((a, b) => {
      const matchA = a.style_vibes?.some((v) => constraints.preferVibes!.includes(v)) ? 1 : 0;
      const matchB = b.style_vibes?.some((v) => constraints.preferVibes!.includes(v)) ? 1 : 0;
      return matchB - matchA;
    });
  }

  return filtered;
}

// ============================================================================
// STYLE PREFERENCES
// ============================================================================

function extractStylePreferencesFromWardrobe(wardrobe: WardrobeItem[]): {
  dominantVibes: string[];
  preferredColors: string[];
  styleDescription: string;
} {
  const vibeCounts: Record<string, number> = {};
  const colorCounts: Record<string, number> = {};

  for (const item of wardrobe) {
    if (item.style_vibes && Array.isArray(item.style_vibes)) {
      for (const vibe of item.style_vibes) {
        vibeCounts[vibe] = (vibeCounts[vibe] || 0) + 1;
      }
    }

    if (item.colors) {
      if (item.colors.primary) {
        colorCounts[item.colors.primary] = (colorCounts[item.colors.primary] || 0) + 1;
      }
      if (item.colors.secondary && Array.isArray(item.colors.secondary)) {
        for (const color of item.colors.secondary) {
          colorCounts[color] = (colorCounts[color] || 0) + 1;
        }
      }
    }
  }

  const dominantVibes = Object.entries(vibeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([vibe]) => vibe);

  const preferredColors = Object.entries(colorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([color]) => color);

  let styleDescription = "";
  if (dominantVibes.length > 0) {
    styleDescription = `User prefers: ${dominantVibes.join(", ")}`;
    if (preferredColors.length > 0) {
      styleDescription += `, with ${preferredColors.slice(0, 3).join(", ")} tones`;
    }
  }

  return { dominantVibes, preferredColors, styleDescription };
}

async function getUserStylePreferences(userId: string): Promise<{
  dominantVibes: string[];
  colorPreferences: Record<string, unknown> | null;
  stylePreferences: Record<string, unknown> | null;
}> {
  const { data } = await supabaseAdmin
    .from("user_taste_vectors")
    .select("dominant_vibes, color_preferences, style_preferences")
    .eq("user_id", userId)
    .single();

  return {
    dominantVibes: (data?.dominant_vibes as string[]) || [],
    colorPreferences: (data?.color_preferences as Record<string, unknown>) || null,
    stylePreferences: (data?.style_preferences as Record<string, unknown>) || null,
  };
}

// ============================================================================
// GEMINI OUTFIT COMPOSITION
// ============================================================================

function buildGeminiOutfitPrompt(params: {
  candidates: Record<string, WardrobeItem[]>;
  occasion?: string;
  mood?: string;
  weather: WeatherData;
  count: number;
  constraints?: GenerationConstraints;
  stylePreferences?: { dominantVibes: string[]; preferredColors: string[] };
  tasteVector?: number[] | null;
}): string {
  const { candidates, occasion, mood, weather, count, constraints, stylePreferences, tasteVector } = params;

  // Format candidates for the prompt (limit to 10 per slot)
  const formattedCandidates: Record<string, unknown[]> = {};
  for (const [slot, items] of Object.entries(candidates)) {
    if (slot === "unknown") continue;
    formattedCandidates[slot] = items.slice(0, 10).map((item) => ({
      id: item.id,
      category: item.category,
      colors: item.colors,
      pattern: item.pattern || "solid",
      style_vibes: item.style_vibes || [],
      formality: item.formality_score || 5,
      name: item.item_name || undefined,
      taste_score: Math.round(scoreTasteAlignment(item.embedding as number[] | null, tasteVector ?? null) * 100) / 100,
    }));
  }

  // Build constraint instructions
  let constraintInstructions = "";
  if (constraints) {
    if (constraints.preferVibes?.length) {
      constraintInstructions += `\n- PREFER items with vibes: ${constraints.preferVibes.join(", ")}`;
    }
    if (constraints.minFormality !== undefined) {
      constraintInstructions += `\n- Minimum formality: ${constraints.minFormality}`;
    }
    if (constraints.maxFormality !== undefined) {
      constraintInstructions += `\n- Maximum formality: ${constraints.maxFormality}`;
    }
    if (constraints.excludeItemIds?.length) {
      constraintInstructions += `\n- DO NOT use these item IDs: ${constraints.excludeItemIds.join(", ")}`;
    }
    if (constraints.mustSwapSlots?.length) {
      constraintInstructions += `\n- MUST use different items for: ${constraints.mustSwapSlots.join(", ")}`;
    }
  }

  // Build style preferences section
  let styleSection = "";
  if (stylePreferences) {
    if (stylePreferences.dominantVibes.length > 0) {
      styleSection += `\n- User's style: ${stylePreferences.dominantVibes.join(", ")}`;
    }
    if (stylePreferences.preferredColors.length > 0) {
      styleSection += `\n- Preferred colors: ${stylePreferences.preferredColors.join(", ")}`;
    }
  }

  return `You are an expert fashion stylist AI. Create ${count} complete outfit combinations from the user's wardrobe.

## CONTEXT
- Occasion: ${occasion || "everyday casual"}
- Mood: ${mood || "balanced"}
- Weather: ${weather.temperature}°C, ${weather.condition}
- Season: ${getCurrentSeason()}
${styleSection ? `\n## USER PREFERENCES${styleSection}` : ""}
${constraintInstructions ? `\n## CONSTRAINTS${constraintInstructions}` : ""}

## AVAILABLE ITEMS BY CATEGORY

${JSON.stringify(formattedCandidates, null, 2)}

## YOUR TASK

Create ${count} stylish, cohesive outfits. Each outfit MUST include:
- 1 top (required)
- 1 bottom (required)
- 1 footwear (required)
- 1 outerwear (optional, include if weather < 15°C or occasion is formal)
- 1-2 accessories (optional)

## STYLING RULES
1. Colors must harmonize (complementary, analogous, or monochromatic)
2. Formality levels should be consistent within each outfit
3. Patterns: max 1 statement pattern per outfit, pair with solids
4. Weather-appropriate: no heavy layers if hot, no light fabrics if cold
5. Each outfit should feel intentional, not random
6. DO NOT repeat the same item across multiple outfits unless necessary
7. PRIORITIZE items with higher taste_score (0-1 scale, higher = better match to user's learned preferences)

## OUTPUT FORMAT
Return ONLY valid JSON, no markdown code blocks:

{
  "outfits": [
    {
      "items": {
        "top": "item_id",
        "bottom": "item_id",
        "footwear": "item_id",
        "outerwear": "item_id or null",
        "accessory": ["item_id"] or []
      },
      "name": "Creative 2-4 word outfit name",
      "vibe": "One word: Effortless, Polished, Bold, Cozy, Edgy, or Classic",
      "reasoning": "1-2 sentences explaining why these pieces work together",
      "styling_tip": "One actionable styling tip (e.g., 'Roll the sleeves for a relaxed look')",
      "color_harmony": "One sentence about the color relationship (e.g., 'Navy and tan create a nautical palette')",
      "confidence_score": 0.85
    }
  ]
}`;
}

async function composeOutfitsWithGemini(params: {
  candidates: Record<string, WardrobeItem[]>;
  occasion?: string;
  mood?: string;
  weather: WeatherData;
  count: number;
  tasteVector?: number[] | null;
  constraints?: GenerationConstraints;
  stylePreferences?: { dominantVibes: string[]; preferredColors: string[] };
}): Promise<GeminiOutfitResponse[] | null> {
  if (!isOpenRouterAvailable()) {
    console.warn("[OutfitGen] OpenRouter not available, skipping Gemini composition");
    return null;
  }

  const prompt = buildGeminiOutfitPrompt(params);

  try {
    console.log("[OutfitGen] Calling Gemini for outfit composition...");
    const response = await callOpenRouterWithFallback(
      [{ role: "user", content: prompt }],
      { max_tokens: 2000, temperature: 0.7 }
    );

    const parsed = parseJsonFromLLMResponse<{ outfits: GeminiOutfitResponse[] }>(response);

    if (!parsed.outfits || !Array.isArray(parsed.outfits)) {
      console.error("[OutfitGen] Invalid Gemini response structure");
      return null;
    }

    // Validate each outfit has required items
    const validOutfits = parsed.outfits.filter((outfit) => {
      return outfit.items?.top && outfit.items?.bottom && outfit.items?.footwear;
    });

    console.log(`[OutfitGen] Gemini returned ${validOutfits.length} valid outfits`);
    return validOutfits;
  } catch (error) {
    console.error("[OutfitGen] Gemini composition failed:", error);
    return null;
  }
}

function enrichGeminiOutfits(
  geminiOutfits: GeminiOutfitResponse[],
  allItems: WardrobeItem[],
  tasteVector: number[] | null,
  weather: WeatherData,
  occasion?: string
): GeneratedOutfit[] {
  const itemMap = new Map(allItems.map((item) => [item.id, item]));

  return geminiOutfits
    .map((outfit) => {
      const itemIds: string[] = [
        outfit.items.top,
        outfit.items.bottom,
        outfit.items.footwear,
        outfit.items.outerwear,
        ...(outfit.items.accessory || []),
      ].filter((id): id is string => Boolean(id));

      const items = itemIds.map((id) => itemMap.get(id)).filter((item): item is WardrobeItem => !!item);

      if (items.length < 3) {
        console.warn(`[OutfitGen] Could not find all items for outfit: ${outfit.name}`);
        return null;
      }

      const tasteScores = items.map((item) =>
        scoreTasteAlignment(item.embedding as number[] | null, tasteVector)
      );
      const avgTasteScore = tasteScores.reduce((a, b) => a + b, 0) / tasteScores.length;

      const colorHarmonyScore = calculateOutfitColorHarmony(
        items.map((item) => (item.colors || {}) as ColorInfo)
      );

      const weatherScore = items.every((item) => {
        const seasons = item.seasons || [];
        const currentSeason = getCurrentSeason();
        return seasons.length === 0 || seasons.includes(currentSeason) || seasons.includes("all");
      })
        ? 0.9
        : 0.6;

      const occasionMatch = items.every((item) => matchesOccasion(item, occasion));

      const styleScore =
        (outfit.confidence_score || 0.8) * 0.4 +
        colorHarmonyScore * 0.3 +
        avgTasteScore * 0.2 +
        weatherScore * 0.1;

      const result: GeneratedOutfit = {
        items,
        item_ids: itemIds,
        name: outfit.name || "Styled Outfit",
        vibe: outfit.vibe || "Casual",
        reasoning: outfit.reasoning || "A curated outfit from your wardrobe.",
        confidence_score: Math.round((outfit.confidence_score || 0.8) * 100) / 100,
        style_score: Math.round(styleScore * 100) / 100,
        color_harmony_score: Math.round(colorHarmonyScore * 100) / 100,
        taste_alignment_score: Math.round(avgTasteScore * 100) / 100,
        weather_score: Math.round(weatherScore * 100) / 100,
        occasion_match: occasionMatch,
      };

      // Add optional fields if present
      if (outfit.styling_tip) {
        result.styling_tip = outfit.styling_tip;
      }
      if (outfit.color_harmony) {
        result.color_harmony_description = outfit.color_harmony;
      }

      return result;
    })
    .filter((outfit): outfit is GeneratedOutfit => outfit !== null);
}

// ============================================================================
// RULE-BASED FALLBACK
// ============================================================================

function generateSingleOutfitRuleBased(
  slotGroups: Record<string, ScoredItem[]>,
  tasteVector: number[] | null,
  weather: WeatherData,
  occasion: string | undefined,
  excludeIds: Set<string>,
  outfitIndex: number
): GeneratedOutfit | null {
  const selectedItems: WardrobeItem[] = [];
  const usedColors: ColorInfo[] = [];

  for (const slot of OUTFIT_SLOTS) {
    const candidates = slotGroups[slot] || [];

    let filtered = candidates.filter(
      (item) =>
        !excludeIds.has(item.id) && matchesOccasion(item, occasion) && item.weather_appropriate
    );

    if (usedColors.length > 0) {
      filtered = filterByColorCompatibility(
        filtered.map((item) => ({ ...item, colors: item.colors as ColorInfo | undefined })),
        usedColors
      );
    }

    filtered.sort((a, b) => {
      const tasteA = scoreTasteAlignment(a.embedding as number[] | null, tasteVector);
      const tasteB = scoreTasteAlignment(b.embedding as number[] | null, tasteVector);
      const seasonA = a.seasonal_score;
      const seasonB = b.seasonal_score;
      return tasteB * 0.6 + seasonB * 0.4 - (tasteA * 0.6 + seasonA * 0.4);
    });

    if (filtered.length === 0) {
      console.log(`[OutfitGen] No suitable item for slot: ${slot}`);
      return null;
    }

    const selected = filtered[0];
    selectedItems.push(selected);
    if (selected.colors) {
      usedColors.push(selected.colors as ColorInfo);
    }
    excludeIds.add(selected.id);
  }

  if (weather.temperature < 15 && slotGroups.outerwear?.length > 0) {
    const outerwearCandidates = slotGroups.outerwear.filter(
      (item) => !excludeIds.has(item.id) && item.weather_appropriate
    );

    if (outerwearCandidates.length > 0) {
      const filtered = filterByColorCompatibility(
        outerwearCandidates.map((item) => ({ ...item, colors: item.colors as ColorInfo })),
        usedColors
      );

      if (filtered.length > 0) {
        const outerwearItem = filtered[0] as unknown as WardrobeItem & ScoredItem;
        selectedItems.push(outerwearItem);
        excludeIds.add(outerwearItem.id);
      }
    }
  }

  const tasteScores = selectedItems.map((item) =>
    scoreTasteAlignment(item.embedding as number[] | null, tasteVector)
  );
  const avgTasteScore = tasteScores.reduce((a, b) => a + b, 0) / tasteScores.length;

  const colorHarmonyScore = calculateOutfitColorHarmony(
    selectedItems.map((item) => (item.colors || {}) as ColorInfo)
  );

  const weatherScores = selectedItems.map((item) => {
    const scored = item as ScoredItem;
    return scored.seasonal_score ?? 0.7;
  });
  const avgWeatherScore = weatherScores.reduce((a, b) => a + b, 0) / weatherScores.length;

  const occasionMatch = selectedItems.every((item) => matchesOccasion(item, occasion));

  const styleScore =
    avgTasteScore * 0.4 + colorHarmonyScore * 0.3 + avgWeatherScore * 0.2 + (occasionMatch ? 0.1 : 0);

  return {
    items: selectedItems,
    item_ids: selectedItems.map((item) => item.id),
    name: `Outfit ${outfitIndex + 1}`,
    vibe: "Casual",
    reasoning: "Auto-generated outfit based on your wardrobe and preferences.",
    confidence_score: 0.7,
    style_score: Math.round(styleScore * 100) / 100,
    color_harmony_score: Math.round(colorHarmonyScore * 100) / 100,
    taste_alignment_score: Math.round(avgTasteScore * 100) / 100,
    weather_score: Math.round(avgWeatherScore * 100) / 100,
    occasion_match: occasionMatch,
  };
}

function generateOutfitsRuleBased(
  slotGroups: Record<string, ScoredItem[]>,
  tasteVector: number[] | null,
  weather: WeatherData,
  occasion: string | undefined,
  excludeItemIds: string[],
  count: number
): GeneratedOutfit[] {
  const outfits: GeneratedOutfit[] = [];
  const globalExclude = new Set(excludeItemIds);

  for (let i = 0; i < count; i++) {
    const outfit = generateSingleOutfitRuleBased(
      slotGroups,
      tasteVector,
      weather,
      occasion,
      new Set(globalExclude),
      i
    );

    if (outfit) {
      outfits.push(outfit);
      outfit.item_ids.forEach((id) => globalExclude.add(id));
    }
  }

  return outfits;
}

// ============================================================================
// MAIN GENERATION FUNCTION
// ============================================================================

export async function generateOutfits(params: GenerationParams): Promise<GenerateOutfitsResult> {
  const { userId, occasion, mood, lat, lon, excludeItemIds = [], count = 4, constraints } = params;

  console.log(`[OutfitGen] Generating ${count} outfits for user ${userId}`);

  // Step 1: Get taste vector FIRST (needed for pgvector search)
  const tasteVector = await getTasteVector(userId);
  const tastePrefs = await getUserStylePreferences(userId);

  // Step 2: Get gender filter for candidate selection
  const genderFilter = await getUserGenderFilter(userId);

  // Step 3: Get weather (needed for seasonal filtering in pgvector)
  let weather: WeatherData;
  if (lat !== undefined && lon !== undefined) {
    weather = (await getWeatherByCoords(lat, lon)) || getDefaultWeather();
  } else {
    weather = getDefaultWeather();
  }
  console.log(`[OutfitGen] Weather: ${weather.temperature}°C, ${weather.condition}`);

  // Step 4: Calculate seasons from weather for DB-level filtering
  const currentSeasons = getSeasonsForWeather(weather);
  console.log(`[OutfitGen] Target seasons: ${currentSeasons.join(", ")}`);

  // Step 5: Get recently worn items for cooldown (exclude from candidates)
  const recentlyWornIds = await getRecentlyWornItemIds(userId, 3);
  if (recentlyWornIds.length > 0) {
    console.log(`[OutfitGen] Excluding ${recentlyWornIds.length} recently worn items (3-day cooldown)`);
  }

  // Step 6: Fetch wardrobe - use pgvector if taste vector exists
  let wardrobe: WardrobeItem[];

  if (tasteVector && tasteVector.length > 0) {
    console.log("[OutfitGen] Using pgvector similarity search for candidates");
    const pgCandidates = await getCandidatesWithPgVector(
      userId,
      tasteVector,
      genderFilter,
      15,
      currentSeasons,
      recentlyWornIds.length > 0 ? recentlyWornIds : null
    );

    if (pgCandidates.length >= 3) {
      wardrobe = pgCandidates;
      console.log(`[OutfitGen] pgvector returned ${wardrobe.length} candidates`);
    } else {
      // Fall back to regular fetch if pgvector returns too few
      console.log("[OutfitGen] pgvector returned too few candidates, falling back to regular fetch");
      wardrobe = await getUserWardrobe(userId);
    }
  } else {
    // No taste vector, use regular wardrobe fetch
    console.log("[OutfitGen] No taste vector, using regular wardrobe fetch");
    wardrobe = await getUserWardrobe(userId);
  }

  if (wardrobe.length < 3) {
    console.log("[OutfitGen] Not enough items in wardrobe");
    return { outfits: [], weather };
  }

  // Step 7: Extract style preferences from wardrobe
  const wardrobePrefs = extractStylePreferencesFromWardrobe(wardrobe);

  const stylePreferences = {
    dominantVibes: tastePrefs.dominantVibes.length > 0 ? tastePrefs.dominantVibes : wardrobePrefs.dominantVibes,
    preferredColors: wardrobePrefs.preferredColors,
  };

  // Step 8: Apply constraints
  wardrobe = applyConstraints(wardrobe, constraints);

  // Step 9: Filter by mood
  if (mood) {
    wardrobe = filterItemsByMood(wardrobe, mood);
  }

  // Step 10: Exclude specified items (in addition to cooldown)
  if (excludeItemIds.length > 0 || constraints?.excludeItemIds?.length) {
    const allExcluded = [...excludeItemIds, ...(constraints?.excludeItemIds || [])];
    wardrobe = wardrobe.filter((item) => !allExcluded.includes(item.id));
  }

  // Step 11: Filter by weather and score items
  const scoredItems = filterByWeather(wardrobe as SeasonalWardrobeItem[], weather);
  const sortedItems = sortBySeasonalFit(scoredItems);

  // Step 12: Group by slot
  const slotGroups = groupBySlot(sortedItems);
  const slotGroupsScored = slotGroups as Record<string, ScoredItem[]>;

  // Step 13: Check if we have items in required slots
  const hasRequired = OUTFIT_SLOTS.every((slot) => (slotGroups[slot]?.length ?? 0) > 0);
  if (!hasRequired) {
    console.log("[OutfitGen] Missing items in required slots");
    return { outfits: [], weather };
  }

  // Step 14: Try Gemini composition first
  let outfits: GeneratedOutfit[] = [];

  if (isOpenRouterAvailable()) {
    const geminiOutfits = await composeOutfitsWithGemini({
      candidates: slotGroups,
      occasion,
      mood,
      weather,
      count,
      tasteVector,
      constraints,
      stylePreferences,
    });

    if (geminiOutfits && geminiOutfits.length > 0) {
      outfits = enrichGeminiOutfits(geminiOutfits, wardrobe, tasteVector, weather, occasion);
      console.log(`[OutfitGen] Gemini generated ${outfits.length} outfits`);
    }
  }

  // Step 15: Fall back to rule-based if Gemini failed or returned too few
  if (outfits.length < count) {
    console.log(`[OutfitGen] Falling back to rule-based generation (have ${outfits.length}, need ${count})`);
    const ruleBasedOutfits = generateOutfitsRuleBased(
      slotGroupsScored,
      tasteVector,
      weather,
      occasion,
      [...excludeItemIds, ...outfits.flatMap((o) => o.item_ids)],
      count - outfits.length
    );
    outfits = [...outfits, ...ruleBasedOutfits];
  }

  // Step 16: Sort by style score
  outfits.sort((a, b) => b.style_score - a.style_score);

  console.log(`[OutfitGen] Generated ${outfits.length} total outfits`);
  return { outfits: outfits.slice(0, count), weather };
}

// ============================================================================
// INTERACTION & PERSISTENCE
// ============================================================================

export async function recordOutfitInteraction(
  userId: string,
  outfitId: string,
  interactionType: "wear" | "save" | "like" | "skip" | "reject"
): Promise<void> {
  const { data: outfit } = await supabaseAdmin
    .from("generated_outfits")
    .select("items")
    .eq("id", outfitId)
    .single();

  if (!outfit?.items) return;

  const { data: items } = await supabaseAdmin
    .from("wardrobe_items")
    .select("embedding")
    .in("id", outfit.items);

  if (!items || items.length === 0) return;

  const embeddings = items
    .map((item) => item.embedding as number[] | null)
    .filter((e): e is number[] => !!e);

  if (embeddings.length === 0) return;

  const avgEmbedding = embeddings[0].map((_, i) =>
    embeddings.reduce((sum, emb) => sum + emb[i], 0) / embeddings.length
  );

  await updateTasteVector(userId, avgEmbedding, interactionType);
}

export async function saveGeneratedOutfit(
  userId: string,
  outfit: GeneratedOutfit,
  occasion?: string,
  weather?: WeatherData
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("generated_outfits")
    .insert({
      user_id: userId,
      items: outfit.item_ids,
      outfit_name: outfit.name,
      vibe: outfit.vibe,
      reasoning: outfit.reasoning,
      confidence_score: outfit.confidence_score,
      occasion: occasion || null,
      style_score: outfit.style_score,
      color_harmony_score: outfit.color_harmony_score,
      taste_alignment_score: outfit.taste_alignment_score,
      weather_score: outfit.weather_score,
      weather_temp: weather?.temperature || null,
      weather_condition: weather?.condition || null,
      is_saved: false,
      is_worn: false,
      generated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("[OutfitGen] Failed to save outfit:", error);
    return null;
  }

  return data.id;
}

// ============================================================================
// AVAILABLE MOODS
// ============================================================================

export const AVAILABLE_MOODS = [
  { id: "confident", label: "Confident", icon: "💪", vibes: ["edgy", "classic", "minimalist"] },
  { id: "cozy", label: "Cozy", icon: "☁️", vibes: ["casual", "bohemian", "relaxed"] },
  { id: "professional", label: "Professional", icon: "💼", vibes: ["classic", "minimalist", "preppy"] },
  { id: "creative", label: "Creative", icon: "🎨", vibes: ["bohemian", "streetwear", "eclectic"] },
  { id: "romantic", label: "Romantic", icon: "💕", vibes: ["romantic", "feminine", "soft"] },
  { id: "energetic", label: "Energetic", icon: "⚡", vibes: ["sporty", "streetwear", "colorful"] },
];

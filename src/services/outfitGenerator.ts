/**
 * Outfit Generator Service
 * Core logic for generating personalized outfit recommendations
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
}

export interface GeneratedOutfit {
  items: WardrobeItem[];
  item_ids: string[];
  style_score: number;
  color_harmony_score: number;
  taste_alignment_score: number;
  weather_score: number;
  occasion_match: boolean;
  // Display properties
  name: string;
  vibe: string;
  reasoning: string;
  styling_tip?: string;
  color_harmony_description?: string;
  confidence_score: number;
}

export interface GenerationConstraints {
  excludeItemIds?: string[];
  preferVibes?: string[];
  minFormality?: number;
  maxFormality?: number;
  avoidColors?: boolean;
  mustSwapSlots?: string[];
  excludeAllPreviousItems?: boolean;
}

export interface GenerationParams {
  userId: string;
  occasion?: string;
  mood?: string;
  lat?: number;
  lon?: number;
  excludeItemIds?: string[];
  count?: number; // Number of outfits to generate
  constraints?: GenerationConstraints;
}

export interface GenerationResult {
  outfits: GeneratedOutfit[];
  weather: WeatherData;
}

// Available moods for filtering
export const AVAILABLE_MOODS = [
  { id: "confident", name: "Confident", icon: "💪" },
  { id: "relaxed", name: "Relaxed", icon: "😌" },
  { id: "creative", name: "Creative", icon: "🎨" },
  { id: "professional", name: "Professional", icon: "💼" },
  { id: "adventurous", name: "Adventurous", icon: "🌟" },
  { id: "romantic", name: "Romantic", icon: "💕" },
  { id: "edgy", name: "Edgy", icon: "⚡" },
  { id: "minimalist", name: "Minimalist", icon: "◻️" },
] as const;

/**
 * Get slot type for a category
 */
function getSlotForCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  const normalized = category.toLowerCase().trim();
  return CATEGORY_TO_SLOT[normalized] || null;
}

/**
 * Get user's wardrobe items
 */
async function getUserWardrobe(userId: string): Promise<WardrobeItem[]> {
  // Debug: First log all items regardless of status
  const { data: allItems } = await supabaseAdmin
    .from("wardrobe_items")
    .select("id, category, processing_status, is_archived")
    .eq("user_id", userId);

  console.log(`[OutfitGen] Total items for user: ${allItems?.length || 0}`);
  if (allItems && allItems.length > 0) {
    const byStatus = allItems.reduce(
      (acc, item) => {
        const status = item.processing_status || "null";
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );
    console.log(`[OutfitGen] Items by status:`, JSON.stringify(byStatus));

    const archived = allItems.filter((i) => i.is_archived).length;
    if (archived > 0) {
      console.log(`[OutfitGen] Archived items: ${archived}`);
    }

    // Log categories for debugging
    const categories = allItems.map((i) => i.category).filter(Boolean);
    console.log(`[OutfitGen] Categories: ${categories.join(", ")}`);
  }

  // Actual query with filters
  const { data, error } = await supabaseAdmin
    .from("wardrobe_items")
    .select(
      "id, category, subcategory, embedding, colors, formality_score, seasons, occasions, style_vibes, processed_image_url, original_image_url, item_name"
    )
    .eq("user_id", userId)
    .eq("is_archived", false)
    .eq("processing_status", "completed");

  if (error) {
    console.error("[OutfitGen] Failed to fetch wardrobe:", error);
    return [];
  }

  console.log(`[OutfitGen] Eligible items after filters: ${data?.length || 0}`);
  return data || [];
}

/**
 * Group items by slot
 */
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

/**
 * Score item against user taste vector
 */
function scoreTasteAlignment(itemEmbedding: number[] | null, tasteVector: number[] | null): number {
  if (!itemEmbedding || !tasteVector) return 0.5;
  const similarity = cosineSimilarity(itemEmbedding, tasteVector);
  // Convert from [-1, 1] to [0, 1]
  return (similarity + 1) / 2;
}

/**
 * Generate a vibe descriptor for the outfit
 */
function generateVibe(items: WardrobeItem[], styleScore: number): string {
  const vibes = items.flatMap((item) => item.style_vibes || []);
  const vibeCount = vibes.reduce(
    (acc, vibe) => {
      acc[vibe] = (acc[vibe] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  const sortedVibes = Object.entries(vibeCount).sort((a, b) => b[1] - a[1]);
  if (sortedVibes.length > 0) {
    return sortedVibes[0][0].charAt(0).toUpperCase() + sortedVibes[0][0].slice(1);
  }

  // Fallback based on score
  if (styleScore > 0.8) return "Stylish";
  if (styleScore > 0.6) return "Casual";
  return "Everyday";
}

/**
 * Generate a name for the outfit
 */
function generateOutfitName(
  items: WardrobeItem[],
  occasion: string | undefined,
  vibe: string
): string {
  const top = items.find((item) => getSlotForCategory(item.category) === "top");
  const topType = top?.subcategory || top?.category || "Top";

  if (occasion) {
    return `${vibe} ${occasion.charAt(0).toUpperCase() + occasion.slice(1)} Look`;
  }

  return `${vibe} ${topType.charAt(0).toUpperCase() + topType.slice(1)} Outfit`;
}

/**
 * Generate reasoning for why the outfit works
 */
function generateReasoning(
  items: WardrobeItem[],
  colorHarmonyScore: number,
  tasteScore: number,
  occasion: string | undefined
): string {
  const reasons: string[] = [];

  if (colorHarmonyScore > 0.7) {
    reasons.push("Colors complement each other nicely");
  }

  if (tasteScore > 0.7) {
    reasons.push("Matches your personal style");
  }

  if (occasion) {
    reasons.push(`Great for ${occasion} occasions`);
  }

  const hasOuterwear = items.some((item) => getSlotForCategory(item.category) === "outerwear");
  if (hasOuterwear) {
    reasons.push("Layered for versatility");
  }

  if (reasons.length === 0) {
    reasons.push("A well-balanced combination for everyday wear");
  }

  return reasons.join(". ") + ".";
}

/**
 * Generate a practical styling tip based on outfit composition
 */
function generateStylingTip(
  items: WardrobeItem[],
  occasion: string | undefined,
  weather: WeatherData
): string {
  const tips: string[] = [];

  const hasTop = items.some((i) => getSlotForCategory(i.category) === "top");
  const hasOuterwear = items.some((i) => getSlotForCategory(i.category) === "outerwear");
  const hasBottom = items.some((i) => getSlotForCategory(i.category) === "bottom");

  // Get average formality
  const avgFormality = items.reduce((sum, i) => sum + (i.formality_score || 5), 0) / items.length;

  // Tucking tips for formal/smart casual
  if (hasTop && hasBottom && avgFormality >= 5) {
    tips.push("Tuck in the top for a more polished silhouette");
  }

  // Casual sleeve rolling
  if (hasTop && avgFormality < 5) {
    tips.push("Roll up the sleeves for an effortless casual look");
  }

  // Layering tips
  if (hasOuterwear && weather.temperature > 18) {
    tips.push("Carry the jacket—perfect for when it cools down");
  }

  // Occasion-specific
  if (occasion === "date") {
    tips.push("Add a subtle accessory to elevate the look");
  } else if (occasion === "work" || occasion === "business") {
    tips.push("Keep accessories minimal and professional");
  }

  return tips[0] || "A versatile combination that works as-is";
}

/**
 * Generate description of why the outfit colors work together
 */
function generateColorHarmonyDescription(items: WardrobeItem[]): string {
  const colors = items
    .map((i) => i.colors?.primary?.toLowerCase())
    .filter((c): c is string => !!c);

  if (colors.length < 2) {
    return "A cohesive monochromatic palette";
  }

  // Color categories
  const neutrals = ["black", "white", "gray", "grey", "beige", "cream", "tan", "khaki", "brown", "navy"];
  const warms = ["red", "orange", "yellow", "coral", "burgundy", "rust", "terracotta"];
  const cools = ["blue", "green", "teal", "mint", "purple", "lavender"];

  const hasNeutrals = colors.some((c) => neutrals.some((n) => c.includes(n)));
  const hasWarms = colors.some((c) => warms.some((w) => c.includes(w)));
  const hasCools = colors.some((c) => cools.some((cl) => c.includes(cl)));

  // All neutrals
  if (colors.every((c) => neutrals.some((n) => c.includes(n)))) {
    if (colors.some((c) => c.includes("navy")) && colors.some((c) => c.includes("khaki") || c.includes("tan"))) {
      return "Navy and khaki create a timeless nautical palette";
    }
    if (colors.some((c) => c.includes("black")) && colors.some((c) => c.includes("white"))) {
      return "Classic black and white for sharp contrast";
    }
    return "Neutrals blend seamlessly for an understated elegance";
  }

  // Warm + neutral
  if (hasWarms && hasNeutrals && !hasCools) {
    return "Warm tones grounded by neutrals for a balanced look";
  }

  // Cool + neutral
  if (hasCools && hasNeutrals && !hasWarms) {
    return "Cool tones paired with neutrals keep it fresh and refined";
  }

  // Mixed warm and cool (complementary)
  if (hasWarms && hasCools) {
    return "Complementary warm and cool tones add visual interest";
  }

  // Earth tones
  if (colors.every((c) => ["brown", "tan", "olive", "khaki", "rust", "beige", "cream"].some((e) => c.includes(e)))) {
    return "Earth tones create a naturally harmonious palette";
  }

  return "Colors work together for a cohesive outfit";
}

/**
 * Check if item matches occasion formality
 */
function matchesOccasion(item: WardrobeItem, occasion: string | undefined): boolean {
  if (!occasion) return true;

  const formalityRange = OCCASION_FORMALITY[occasion.toLowerCase()];
  if (!formalityRange) return true;

  const itemFormality = item.formality_score ?? 5; // Default to middle
  return itemFormality >= formalityRange.min && itemFormality <= formalityRange.max;
}

/**
 * Generate a single outfit
 */
function generateSingleOutfit(
  slotGroups: Record<string, ScoredItem[]>,
  tasteVector: number[] | null,
  weather: WeatherData,
  occasion: string | undefined,
  excludeIds: Set<string>
): GeneratedOutfit | null {
  const selectedItems: WardrobeItem[] = [];
  const usedColors: ColorInfo[] = [];

  // Select items for required slots
  for (const slot of OUTFIT_SLOTS) {
    const candidates = slotGroups[slot] || [];

    // Filter by:
    // 1. Not excluded
    // 2. Occasion match
    // 3. Weather appropriate
    let filtered = candidates.filter(
      (item) =>
        !excludeIds.has(item.id) &&
        matchesOccasion(item, occasion) &&
        item.weather_appropriate
    );

    // Debug logging
    console.log(
      `[OutfitGen] Slot ${slot}: ${candidates.length} candidates, ${filtered.length} after weather filter`
    );

    // FOOTWEAR FALLBACK: If no weather-appropriate footwear, use any available
    // Better to suggest sneakers in cold weather than fail to generate an outfit
    if (filtered.length === 0 && slot === "footwear") {
      const fallback = candidates.filter(
        (item) => !excludeIds.has(item.id) && matchesOccasion(item, occasion)
      );
      if (fallback.length > 0) {
        console.log(
          `[OutfitGen] No weather-appropriate footwear, falling back to ${fallback.length} available`
        );
        filtered = fallback;
      }
    }

    // Color filter
    if (usedColors.length > 0) {
      filtered = filterByColorCompatibility(
        filtered.map((item) => ({ ...item, colors: item.colors as ColorInfo | undefined })),
        usedColors
      );
    }

    // Sort by taste alignment and seasonal fit
    filtered.sort((a, b) => {
      const tasteA = scoreTasteAlignment(a.embedding as number[] | null, tasteVector);
      const tasteB = scoreTasteAlignment(b.embedding as number[] | null, tasteVector);
      const seasonA = a.seasonal_score;
      const seasonB = b.seasonal_score;
      // Combined score
      return tasteB * 0.6 + seasonB * 0.4 - (tasteA * 0.6 + seasonA * 0.4);
    });

    if (filtered.length === 0) {
      // Required slot not fillable
      console.log(`[OutfitGen] No suitable item for slot: ${slot}`);
      return null;
    }

    // Pick top candidate
    const selected = filtered[0];
    selectedItems.push(selected);
    if (selected.colors) {
      usedColors.push(selected.colors as ColorInfo);
    }
    excludeIds.add(selected.id);
  }

  // Optional: Add outerwear if cold
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

  // Calculate scores
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

  // Combined style score
  const styleScore =
    avgTasteScore * 0.4 + colorHarmonyScore * 0.3 + avgWeatherScore * 0.2 + (occasionMatch ? 0.1 : 0);

  // Generate display properties
  const vibe = generateVibe(selectedItems, styleScore);
  const name = generateOutfitName(selectedItems, occasion, vibe);
  const reasoning = generateReasoning(selectedItems, colorHarmonyScore, avgTasteScore, occasion);
  const stylingTip = generateStylingTip(selectedItems, occasion, weather);
  const colorHarmonyDesc = generateColorHarmonyDescription(selectedItems);

  return {
    items: selectedItems,
    item_ids: selectedItems.map((item) => item.id),
    style_score: Math.round(styleScore * 100) / 100,
    color_harmony_score: Math.round(colorHarmonyScore * 100) / 100,
    taste_alignment_score: Math.round(avgTasteScore * 100) / 100,
    weather_score: Math.round(avgWeatherScore * 100) / 100,
    occasion_match: occasionMatch,
    name,
    vibe,
    reasoning,
    styling_tip: stylingTip,
    color_harmony_description: colorHarmonyDesc,
    confidence_score: Math.round(styleScore * 100) / 100,
  };
}

/**
 * Main outfit generation function
 */
export async function generateOutfits(params: GenerationParams): Promise<GenerationResult> {
  const { userId, occasion, lat, lon, excludeItemIds = [], count = 3, constraints } = params;

  console.log(`[OutfitGen] Generating ${count} outfits for user ${userId}`);

  // Get weather first so we can return it even on early exits
  let weather: WeatherData;
  if (lat !== undefined && lon !== undefined) {
    weather = (await getWeatherByCoords(lat, lon)) || getDefaultWeather();
  } else {
    weather = getDefaultWeather();
  }
  console.log(`[OutfitGen] Weather: ${weather.temperature}C, ${weather.condition}`);

  // Fetch wardrobe
  const wardrobe = await getUserWardrobe(userId);
  if (wardrobe.length < 3) {
    console.log("[OutfitGen] Not enough items in wardrobe");
    return { outfits: [], weather };
  }

  // Get taste vector
  const tasteVector = await getTasteVector(userId);

  // Filter by weather and score items
  const scoredItems = filterByWeather(wardrobe as SeasonalWardrobeItem[], weather);
  const sortedItems = sortBySeasonalFit(scoredItems);

  // Group by slot
  const slotGroups = groupBySlot(sortedItems) as Record<string, ScoredItem[]>;

  // Debug: Log items by slot
  console.log(
    `[OutfitGen] Items by slot: top=${slotGroups.top?.length || 0}, bottom=${slotGroups.bottom?.length || 0}, footwear=${slotGroups.footwear?.length || 0}, outerwear=${slotGroups.outerwear?.length || 0}, unknown=${slotGroups.unknown?.length || 0}`
  );

  // Log unknown categories for debugging
  if (slotGroups.unknown?.length > 0) {
    const unknownCats = slotGroups.unknown.map((i) => i.category).join(", ");
    console.log(`[OutfitGen] Unrecognized categories: ${unknownCats}`);
  }

  // Check if we have items in required slots
  const hasRequired = OUTFIT_SLOTS.every((slot) => (slotGroups[slot]?.length ?? 0) > 0);
  if (!hasRequired) {
    const missing = OUTFIT_SLOTS.filter((slot) => (slotGroups[slot]?.length ?? 0) === 0);
    console.log(`[OutfitGen] Missing items in required slots: ${missing.join(", ")}`);
    return { outfits: [], weather };
  }

  // Apply constraints if provided
  let effectiveExcludeIds = [...excludeItemIds];
  if (constraints?.excludeItemIds) {
    effectiveExcludeIds = [...effectiveExcludeIds, ...constraints.excludeItemIds];
  }

  // Generate multiple outfits
  const outfits: GeneratedOutfit[] = [];
  const globalExclude = new Set(effectiveExcludeIds);

  for (let i = 0; i < count; i++) {
    // Each outfit uses a fresh exclude set but builds on global excludes
    const outfit = generateSingleOutfit(
      slotGroups,
      tasteVector,
      weather,
      occasion,
      new Set(globalExclude)
    );

    if (outfit) {
      outfits.push(outfit);
      // Add these items to global exclude for variety
      outfit.item_ids.forEach((id) => globalExclude.add(id));
    }
  }

  // Sort by style score
  outfits.sort((a, b) => b.style_score - a.style_score);

  console.log(`[OutfitGen] Generated ${outfits.length} outfits`);
  return { outfits, weather };
}

/**
 * Record user interaction with outfit
 */
export async function recordOutfitInteraction(
  userId: string,
  outfitId: string,
  interactionType: "wear" | "save" | "like" | "skip" | "reject"
): Promise<void> {
  // Get outfit items
  const { data: outfit } = await supabaseAdmin
    .from("generated_outfits")
    .select("items")
    .eq("id", outfitId)
    .single();

  if (!outfit?.items) return;

  // Get embeddings for outfit items
  const { data: items } = await supabaseAdmin
    .from("wardrobe_items")
    .select("embedding")
    .in("id", outfit.items);

  if (!items || items.length === 0) return;

  // Average outfit embedding - use Array.isArray for proper type checking
  const embeddings = items
    .map((item) => item.embedding)
    .filter((e): e is number[] => Array.isArray(e) && e.length > 0);

  if (embeddings.length === 0) return;

  try {
    const avgEmbedding = embeddings[0].map((_, i) =>
      embeddings.reduce((sum, emb) => sum + emb[i], 0) / embeddings.length
    );

    // Update taste vector
    await updateTasteVector(userId, avgEmbedding, interactionType);
  } catch (err) {
    console.error("[OutfitGen] Failed to update taste vector:", err);
    // Don't crash the request - taste tracking is non-critical
  }
}

/**
 * Save outfit to database
 */
export async function saveGeneratedOutfit(
  userId: string,
  outfit: GeneratedOutfit,
  occasion?: string,
  weather?: WeatherData
): Promise<string | null> {
  console.log(`[OutfitGen] Saving outfit for user ${userId}, items: ${outfit.item_ids.join(", ")}`);

  const insertData = {
    user_id: userId,
    items: outfit.item_ids,
    occasion: occasion || null,
    style_score: outfit.style_score,
    color_harmony_score: outfit.color_harmony_score,
    taste_alignment_score: outfit.taste_alignment_score,
    weather_score: outfit.weather_score,
    outfit_name: outfit.name,
    vibe: outfit.vibe,
    reasoning: outfit.reasoning,
    styling_tip: outfit.styling_tip || null,
    color_harmony_description: outfit.color_harmony_description || null,
    confidence_score: outfit.confidence_score,
    weather_temp: weather?.temperature != null ? Math.round(weather.temperature) : null,
    weather_condition: weather?.condition,
    is_saved: false,
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
  };

  const { data, error } = await supabaseAdmin
    .from("generated_outfits")
    .insert(insertData)
    .select("id")
    .single();

  if (error) {
    console.error("[OutfitGen] Failed to save outfit:", error);
    console.error("[OutfitGen] Insert data was:", JSON.stringify(insertData));
    return null;
  }

  console.log(`[OutfitGen] Saved outfit with ID: ${data.id}`);
  return data.id;
}

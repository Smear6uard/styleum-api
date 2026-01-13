/**
 * AI-Powered Styling Tips Service
 * Generates personalized styling tips based on user profile and outfit composition
 */

import { callOpenRouterWithFallback, isOpenRouterAvailable } from "./openrouter.js";

export interface UserContext {
  heightCategory?: "short" | "average" | "tall" | null;
  skinUndertone?: "warm" | "cool" | "neutral" | null;
  clothingStyle?: "menswear" | "womenswear";
}

export interface OutfitItem {
  category?: string | null;
  subcategory?: string | null;
  colors?: {
    primary?: string | null;
    secondary?: string[] | null;
  } | null;
  formality_score?: number | null;
  item_name?: string | null;
}

export interface WeatherContext {
  temperature: number;
  condition: string;
}

/**
 * Build the user profile section of the prompt
 */
function buildUserContextPrompt(userContext: UserContext): string {
  const parts: string[] = [];

  if (userContext.heightCategory) {
    const heightLabel = `${userContext.heightCategory} (${userContext.clothingStyle || "womenswear"} fit)`;
    parts.push(`Height: ${heightLabel}`);
  }

  if (userContext.skinUndertone) {
    parts.push(`Skin Undertone: ${userContext.skinUndertone}`);
  }

  if (parts.length === 0) {
    return "";
  }

  return `User: ${parts.join(", ")}`;
}

/**
 * Build outfit description for the prompt
 */
function buildOutfitDescription(items: OutfitItem[]): string {
  return items
    .map((item) => {
      const name = item.item_name || item.subcategory || item.category || "item";
      const color = item.colors?.primary || "";
      return color ? `${color} ${name}` : name;
    })
    .join(", ");
}

/**
 * Generate a personalized styling tip using AI
 * Falls back to a generic tip if AI is unavailable or fails
 */
export async function generatePersonalizedStylingTip(
  items: OutfitItem[],
  userContext: UserContext,
  weather: WeatherContext,
  occasion?: string
): Promise<string> {
  // If no user context, return early with generic tip
  if (!userContext.heightCategory && !userContext.skinUndertone) {
    return generateFallbackTip(items, occasion, weather);
  }

  // Check if OpenRouter is available
  if (!isOpenRouterAvailable()) {
    console.log("[StylingTips] OpenRouter not available, using fallback");
    return generateFallbackTip(items, occasion, weather);
  }

  try {
    const userPrompt = buildUserContextPrompt(userContext);
    const outfitDesc = buildOutfitDescription(items);

    const systemPrompt = `You are a personal stylist. Generate ONE concise styling tip (max 2 sentences) for this outfit.

${userPrompt}
Outfit: ${outfitDesc}
Weather: ${Math.round(weather.temperature)}°F, ${weather.condition}
${occasion ? `Occasion: ${occasion}` : ""}

Consider these guidelines based on the user's attributes:
${userContext.heightCategory === "short" ? "- For shorter frames: elongating silhouettes, vertical lines, monochromatic looks, properly proportioned layers, and well-fitted pieces work well." : ""}
${userContext.heightCategory === "tall" ? "- For taller frames: can carry oversized pieces, statement layering, and bold proportions confidently." : ""}
${userContext.skinUndertone === "warm" ? "- Warm undertones: earth tones, warm whites/creams, gold accessories, and warm-based colors complement well." : ""}
${userContext.skinUndertone === "cool" ? "- Cool undertones: jewel tones, crisp whites, silver accessories, and blue-based colors complement well." : ""}
${userContext.skinUndertone === "neutral" ? "- Neutral undertones: versatile with both warm and cool palettes." : ""}

Make the tip specific and actionable. Reference their proportions or coloring naturally, not robotically.
Good example: "The high-waisted trouser elongates your frame nicely - try a French tuck to emphasize that line."
Bad example: "As a short person with warm undertone, this outfit is good for you."

Return ONLY the styling tip, no preamble or explanation.`;

    const response = await callOpenRouterWithFallback(
      [{ role: "user", content: systemPrompt }],
      { max_tokens: 150, temperature: 0.7 }
    );

    // Clean up response - remove quotes if wrapped
    let tip = response.trim();
    if ((tip.startsWith('"') && tip.endsWith('"')) || (tip.startsWith("'") && tip.endsWith("'"))) {
      tip = tip.slice(1, -1);
    }

    console.log(`[StylingTips] Generated personalized tip for ${userContext.heightCategory || "unknown"} height, ${userContext.skinUndertone || "unknown"} undertone`);
    return tip;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[StylingTips] AI generation failed, using fallback:", errorMessage);
    return generateFallbackTip(items, occasion, weather);
  }
}

/**
 * Fallback rule-based styling tip generator
 * Used when AI is unavailable or fails
 */
function generateFallbackTip(
  items: OutfitItem[],
  occasion: string | undefined,
  weather: WeatherContext
): string {
  const tips: string[] = [];

  const hasTop = items.some((i) =>
    ["t-shirt", "shirt", "blouse", "sweater", "hoodie", "top", "polo", "cardigan"].includes(
      (i.category || "").toLowerCase()
    )
  );
  const hasBottom = items.some((i) =>
    ["pants", "jeans", "trousers", "shorts", "skirt", "bottom", "leggings", "chinos", "joggers"].includes(
      (i.category || "").toLowerCase()
    )
  );
  const hasOuterwear = items.some((i) =>
    ["jacket", "coat", "blazer", "outerwear", "vest", "parka"].includes(
      (i.category || "").toLowerCase()
    )
  );

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

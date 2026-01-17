/**
 * AI-Powered Outfit Descriptions Service
 * Generates personalized, specific descriptions for outfit compositions
 */

import { callOpenRouterWithFallback, isOpenRouterAvailable, parseJsonFromLLMResponse } from "./openrouter.js";
import type { UserContext } from "./stylingTips.js";

export interface OutfitItem {
  category?: string | null;
  subcategory?: string | null;
  colors?: {
    primary?: string | null;
    secondary?: string[] | null;
  } | null;
  formality_score?: number | null;
  item_name?: string | null;
  fit?: "oversized" | "relaxed" | "regular" | "fitted" | "slim" | null;
  length?: "cropped" | "regular" | "longline" | null;
  style_vibes?: string[] | null;
}

export interface WeatherContext {
  temperature: number;
  condition: string;
}

export interface OutfitDescriptions {
  whyItWorks: string;
  stylingTip: string;
  colorHarmony: string | null;
}

/**
 * Build a rich item description for the prompt
 */
function buildItemDescription(item: OutfitItem): string {
  const parts: string[] = [];

  // Name or category
  const name = item.item_name || item.subcategory || item.category || "item";
  parts.push(name);

  // Color info
  if (item.colors?.primary) {
    parts.unshift(item.colors.primary);
  }

  // Fit info
  if (item.fit && item.fit !== "regular") {
    parts.push(`(${item.fit} fit)`);
  }

  // Length info
  if (item.length && item.length !== "regular") {
    parts.push(`(${item.length})`);
  }

  return parts.join(" ");
}

/**
 * Build the full prompt for outfit description generation
 */
function buildPrompt(
  items: OutfitItem[],
  userContext: UserContext,
  weather: WeatherContext,
  occasion?: string
): string {
  const itemDescriptions = items
    .map((item, i) => {
      const desc = buildItemDescription(item);
      const secondaryColors = item.colors?.secondary?.length
        ? ` with ${item.colors.secondary.join(", ")} accents`
        : "";
      const vibes = item.style_vibes?.length ? ` [${item.style_vibes.join(", ")}]` : "";
      return `${i + 1}. ${desc}${secondaryColors}${vibes}`;
    })
    .join("\n");

  // Extract all colors for reference
  const allColors = items
    .flatMap((item) => [item.colors?.primary, ...(item.colors?.secondary || [])])
    .filter((c): c is string => !!c);
  const uniqueColors = [...new Set(allColors)];

  return `You are a professional fashion stylist writing descriptions for a specific outfit. Your descriptions should sound like expert advice from a personal stylist who has carefully examined each piece.

## OUTFIT ITEMS:
${itemDescriptions}

## COLOR PALETTE:
${uniqueColors.length > 0 ? uniqueColors.join(", ") : "Not specified"}

## CONTEXT:
- Occasion: ${occasion || "everyday casual"}
- Weather: ${Math.round(weather.temperature)}°F, ${weather.condition}
${userContext.heightCategory ? `- User build: ${userContext.heightCategory} frame` : ""}
${userContext.skinUndertone ? `- Complexion: ${userContext.skinUndertone} undertone` : ""}

## YOUR TASK:

Generate a JSON object with exactly these three fields:

### "whyItWorks" (string, 2-3 sentences):
REQUIREMENTS:
- Reference the ACTUAL item names from the list above (e.g., "The corduroy shirt pairs beautifully with the khaki carpenter pants")
- Explain the SPECIFIC color relationship using actual colors (e.g., "The warm brown and tan create a cohesive earth-toned palette")
- Mention why it suits the occasion/vibe (e.g., "Perfect for a relaxed weekend coffee run")
${userContext.heightCategory ? `- If relevant, mention how pieces work for a ${userContext.heightCategory} frame` : ""}
${userContext.skinUndertone ? `- If relevant, mention how colors complement a ${userContext.skinUndertone} complexion` : ""}

BANNED PHRASES - never use these generic phrases:
- "colors complement each other"
- "works well together"
- "nice combination"
- "great pairing"
- "goes well with"
- "versatile piece"

### "stylingTip" (string, 1-2 sentences):
REQUIREMENTS:
- Must be SPECIFIC to the actual items in this outfit
- Must be ACTIONABLE (something the user can physically do)
- Reference item names when giving advice
- Examples of GOOD tips:
  - "Cuff the carpenter pants once to show off the leather boots and add visual interest"
  - "Leave the top button of the oxford undone for a relaxed vibe that matches the casual sneakers"
  - "Half-tuck the front of the sweater into the high-waisted jeans to define your waist"

BANNED - generic tips like:
- "roll up your sleeves"
- "add accessories"
- "try a belt"
- "keep it simple"

### "colorHarmony" (string OR null):
REQUIREMENTS:
- Only return a value if there's something GENUINELY interesting about the color combination
- Must reference the ACTUAL colors by name
- Good examples:
  - "The navy and rust create a classic autumn contrast with the tan boots anchoring the palette"
  - "Monochromatic grays create a sleek, modern silhouette with depth from varying textures"
- Return null if:
  - The outfit is mostly neutrals without a distinctive color story
  - There's nothing specific worth mentioning about the colors
  - The combination is too basic to warrant a description

BANNED phrases:
- "colors complement each other"
- "harmonious palette"
- "work together nicely"

## OUTPUT FORMAT:
Return ONLY valid JSON with no markdown formatting, no code blocks, no explanation. Example:
{"whyItWorks": "...", "stylingTip": "...", "colorHarmony": "..." or null}`;
}

/**
 * Generate AI-powered outfit descriptions
 * Returns specific, detailed descriptions for whyItWorks, stylingTip, and colorHarmony
 */
export async function generateOutfitDescriptions(
  items: OutfitItem[],
  userContext: UserContext,
  weather: WeatherContext,
  occasion?: string
): Promise<OutfitDescriptions> {
  if (!isOpenRouterAvailable()) {
    throw new Error("OpenRouter not available");
  }

  const prompt = buildPrompt(items, userContext, weather, occasion);

  console.log("[OutfitDescriptions] Generating AI descriptions for outfit with", items.length, "items");

  const response = await callOpenRouterWithFallback(
    [{ role: "user", content: prompt }],
    { max_tokens: 500, temperature: 0.7 }
  );

  console.log("[OutfitDescriptions] Raw AI response:", response);

  const parsed = parseJsonFromLLMResponse<{
    whyItWorks?: string;
    stylingTip?: string;
    colorHarmony?: string | null;
  }>(response);

  console.log("[OutfitDescriptions] Parsed result:", JSON.stringify(parsed, null, 2));
  console.log("[OutfitDescriptions] stylingTip value:", parsed.stylingTip);

  // Validate response
  if (!parsed.whyItWorks || typeof parsed.whyItWorks !== "string") {
    throw new Error("Invalid AI response: missing whyItWorks");
  }
  if (!parsed.stylingTip || typeof parsed.stylingTip !== "string") {
    throw new Error("Invalid AI response: missing stylingTip");
  }

  console.log("[OutfitDescriptions] Successfully generated AI descriptions");

  return {
    whyItWorks: parsed.whyItWorks,
    stylingTip: parsed.stylingTip,
    colorHarmony: parsed.colorHarmony ?? null,
  };
}

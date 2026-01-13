/**
 * Color Harmony Service
 * Evaluates color compatibility between outfit items
 */

// Color name to HSL mapping (approximate)
const COLOR_HSL: Record<string, { h: number; s: number; l: number }> = {
  // Neutrals (low saturation, work with everything)
  black: { h: 0, s: 0, l: 5 },
  white: { h: 0, s: 0, l: 100 },
  gray: { h: 0, s: 0, l: 50 },
  grey: { h: 0, s: 0, l: 50 },
  charcoal: { h: 0, s: 0, l: 25 },
  ivory: { h: 60, s: 10, l: 95 },
  cream: { h: 45, s: 20, l: 90 },
  beige: { h: 40, s: 25, l: 75 },
  tan: { h: 35, s: 35, l: 65 },
  taupe: { h: 30, s: 15, l: 55 },
  brown: { h: 30, s: 50, l: 35 },
  "dark brown": { h: 25, s: 60, l: 20 },
  camel: { h: 35, s: 45, l: 55 },
  khaki: { h: 45, s: 30, l: 60 },
  navy: { h: 220, s: 70, l: 20 },
  "navy blue": { h: 220, s: 70, l: 20 },

  // Primary colors
  red: { h: 0, s: 85, l: 50 },
  blue: { h: 220, s: 80, l: 50 },
  yellow: { h: 55, s: 90, l: 55 },

  // Secondary colors
  green: { h: 120, s: 60, l: 40 },
  orange: { h: 30, s: 90, l: 55 },
  purple: { h: 280, s: 60, l: 45 },
  violet: { h: 280, s: 60, l: 45 },

  // Tertiary and fashion colors
  pink: { h: 340, s: 70, l: 70 },
  "hot pink": { h: 330, s: 85, l: 55 },
  coral: { h: 15, s: 75, l: 60 },
  salmon: { h: 10, s: 60, l: 70 },
  maroon: { h: 0, s: 60, l: 25 },
  burgundy: { h: 345, s: 70, l: 25 },
  wine: { h: 345, s: 60, l: 30 },
  teal: { h: 180, s: 70, l: 35 },
  turquoise: { h: 175, s: 70, l: 50 },
  aqua: { h: 180, s: 70, l: 60 },
  cyan: { h: 180, s: 80, l: 50 },
  "sky blue": { h: 200, s: 70, l: 65 },
  "light blue": { h: 200, s: 60, l: 75 },
  "royal blue": { h: 225, s: 80, l: 45 },
  cobalt: { h: 220, s: 80, l: 45 },
  indigo: { h: 260, s: 70, l: 35 },
  lavender: { h: 270, s: 50, l: 75 },
  lilac: { h: 280, s: 45, l: 75 },
  magenta: { h: 300, s: 80, l: 50 },
  "forest green": { h: 130, s: 60, l: 25 },
  "olive green": { h: 80, s: 50, l: 35 },
  olive: { h: 80, s: 50, l: 35 },
  sage: { h: 100, s: 30, l: 55 },
  mint: { h: 150, s: 50, l: 70 },
  "lime green": { h: 90, s: 70, l: 50 },
  mustard: { h: 45, s: 85, l: 45 },
  gold: { h: 45, s: 80, l: 50 },
  rust: { h: 20, s: 70, l: 40 },
  terracotta: { h: 15, s: 55, l: 50 },
  copper: { h: 25, s: 75, l: 45 },
  peach: { h: 25, s: 75, l: 75 },
  blush: { h: 350, s: 35, l: 80 },
  mauve: { h: 320, s: 25, l: 60 },
  plum: { h: 300, s: 45, l: 35 },
  denim: { h: 210, s: 50, l: 45 },

  // Patterns (treat as neutral)
  multicolor: { h: 0, s: 0, l: 50 },
  pattern: { h: 0, s: 0, l: 50 },
};

// Neutral colors that go with almost everything
const NEUTRALS = new Set([
  "black",
  "white",
  "gray",
  "grey",
  "charcoal",
  "navy",
  "navy blue",
  "cream",
  "ivory",
  "beige",
  "tan",
  "taupe",
  "brown",
  "dark brown",
  "camel",
  "khaki",
  "denim",
]);

/**
 * Normalize color name for lookup
 */
function normalizeColor(color: string): string {
  return color.toLowerCase().trim();
}

/**
 * Get HSL values for a color name
 */
function getColorHSL(color: string): { h: number; s: number; l: number } | null {
  const normalized = normalizeColor(color);

  if (COLOR_HSL[normalized]) {
    return COLOR_HSL[normalized];
  }

  // Try partial match
  for (const [name, hsl] of Object.entries(COLOR_HSL)) {
    if (normalized.includes(name) || name.includes(normalized)) {
      return hsl;
    }
  }

  return null;
}

/**
 * Check if a color is neutral
 */
function isNeutral(color: string): boolean {
  const normalized = normalizeColor(color);
  if (NEUTRALS.has(normalized)) return true;

  const hsl = getColorHSL(color);
  if (!hsl) return false;

  // Low saturation = neutral
  return hsl.s < 15;
}

/**
 * Calculate hue difference (accounting for circular nature)
 */
function hueDifference(h1: number, h2: number): number {
  const diff = Math.abs(h1 - h2);
  return Math.min(diff, 360 - diff);
}

/**
 * Score color pair harmony (0-1)
 */
function scoreColorPair(color1: string, color2: string): number {
  // Same color = perfect
  if (normalizeColor(color1) === normalizeColor(color2)) return 1.0;

  // Neutrals go with everything
  if (isNeutral(color1) || isNeutral(color2)) return 0.95;

  const hsl1 = getColorHSL(color1);
  const hsl2 = getColorHSL(color2);

  if (!hsl1 || !hsl2) {
    // Unknown colors, neutral score
    return 0.7;
  }

  const hueDiff = hueDifference(hsl1.h, hsl2.h);
  const satDiff = Math.abs(hsl1.s - hsl2.s);
  const lightDiff = Math.abs(hsl1.l - hsl2.l);

  // Harmony types scoring
  let harmonyScore = 0;

  // Monochromatic (same hue, different saturation/lightness)
  if (hueDiff < 15) {
    harmonyScore = 0.9 - lightDiff * 0.002;
  }
  // Complementary (opposite, 180 degrees)
  else if (hueDiff >= 160 && hueDiff <= 200) {
    harmonyScore = 0.85;
  }
  // Split complementary (150-180 degrees)
  else if (hueDiff >= 130 && hueDiff < 160) {
    harmonyScore = 0.8;
  }
  // Triadic (120 degrees)
  else if (hueDiff >= 110 && hueDiff <= 130) {
    harmonyScore = 0.75;
  }
  // Analogous (30-60 degrees)
  else if (hueDiff >= 25 && hueDiff <= 65) {
    harmonyScore = 0.85;
  }
  // Square/tetradic (90 degrees)
  else if (hueDiff >= 80 && hueDiff < 110) {
    harmonyScore = 0.7;
  }
  // Other combinations
  else {
    harmonyScore = 0.5;
  }

  // Adjust for saturation similarity (similar saturation levels work better)
  if (satDiff < 20) {
    harmonyScore += 0.05;
  } else if (satDiff > 50) {
    harmonyScore -= 0.1;
  }

  return Math.max(0, Math.min(1, harmonyScore));
}

export interface ColorInfo {
  primary?: string | null | undefined;
  secondary?: string[] | null | undefined;
  accent?: string | null | undefined;
}

/**
 * Calculate color harmony score for an outfit
 */
export function calculateOutfitColorHarmony(items: ColorInfo[]): number {
  if (items.length < 2) return 1.0; // Single item is always harmonious

  // Get all primary colors
  const colors: string[] = items
    .map((item) => item.primary)
    .filter((c): c is string => !!c);

  if (colors.length < 2) return 0.9; // Not enough colors to compare

  // Score all pairs
  let totalScore = 0;
  let pairCount = 0;

  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      totalScore += scoreColorPair(colors[i], colors[j]);
      pairCount++;
    }
  }

  // Also consider secondary colors if they clash
  const secondaries = items.flatMap((item) => item.secondary || []);
  for (const secondary of secondaries) {
    for (const primary of colors) {
      const pairScore = scoreColorPair(secondary, primary);
      if (pairScore < 0.5) {
        // Clashing secondary color
        totalScore -= 0.1;
      }
    }
  }

  return Math.max(0, Math.min(1, pairCount > 0 ? totalScore / pairCount : 1));
}

/**
 * Check if specific color combination works
 */
export function colorsAreCompatible(color1: string, color2: string): boolean {
  return scoreColorPair(color1, color2) >= 0.6;
}

/**
 * Get complementary color suggestions
 */
export function getComplementaryColors(color: string): string[] {
  const hsl = getColorHSL(color);
  if (!hsl) return ["black", "white", "gray"];

  // Complementary hue
  const complementHue = (hsl.h + 180) % 360;

  // Find colors close to complementary
  const suggestions: string[] = [];
  for (const [name, hslValue] of Object.entries(COLOR_HSL)) {
    const diff = hueDifference(complementHue, hslValue.h);
    if (diff < 30 && !NEUTRALS.has(name)) {
      suggestions.push(name);
    }
  }

  // Always include some neutrals
  suggestions.push("black", "white", "navy");

  return [...new Set(suggestions)].slice(0, 5);
}

// Colors that complement different skin undertones
const WARM_UNDERTONE_COLORS = new Set([
  "brown", "dark brown", "camel", "tan", "beige", "cream", "ivory", "khaki",
  "rust", "terracotta", "copper", "coral", "peach", "salmon", "orange",
  "mustard", "gold", "olive", "olive green", "warm white", "red", "burgundy"
]);

const COOL_UNDERTONE_COLORS = new Set([
  "navy", "navy blue", "royal blue", "cobalt", "blue", "sky blue", "light blue",
  "teal", "turquoise", "aqua", "cyan", "purple", "violet", "lavender", "lilac",
  "plum", "magenta", "pink", "hot pink", "white", "gray", "grey", "charcoal",
  "burgundy", "wine", "forest green", "emerald", "mint"
]);

// Colors that work well for both undertones (neutrals essentially)
const NEUTRAL_UNDERTONE_COLORS = new Set([
  "black", "white", "gray", "grey", "charcoal", "navy", "navy blue",
  "denim", "taupe", "jade", "soft pink", "dusty rose", "mauve"
]);

export type SkinUndertone = "warm" | "cool" | "neutral";

/**
 * Get a color boost/penalty score based on skin undertone compatibility
 * Returns a value between -0.15 and +0.15 to adjust color harmony scoring
 */
export function getUndertoneColorBoost(color: string, undertone: SkinUndertone | null | undefined): number {
  if (!undertone || !color) return 0;

  const normalized = normalizeColor(color);

  // Neutral undertones work with everything
  if (undertone === "neutral") {
    return NEUTRAL_UNDERTONE_COLORS.has(normalized) ? 0.05 : 0;
  }

  if (undertone === "warm") {
    if (WARM_UNDERTONE_COLORS.has(normalized)) return 0.12;
    if (COOL_UNDERTONE_COLORS.has(normalized)) return -0.08;
    return 0;
  }

  if (undertone === "cool") {
    if (COOL_UNDERTONE_COLORS.has(normalized)) return 0.12;
    if (WARM_UNDERTONE_COLORS.has(normalized)) return -0.08;
    return 0;
  }

  return 0;
}

/**
 * Calculate aggregate undertone boost for an outfit's colors
 */
export function calculateOutfitUndertoneBoost(items: ColorInfo[], undertone: SkinUndertone | null | undefined): number {
  if (!undertone) return 0;

  const colors = items
    .map((item) => item.primary)
    .filter((c): c is string => !!c);

  if (colors.length === 0) return 0;

  const totalBoost = colors.reduce((sum, color) => sum + getUndertoneColorBoost(color, undertone), 0);
  return totalBoost / colors.length;
}

/**
 * Filter items by color compatibility with existing items
 */
export function filterByColorCompatibility<T extends { colors?: ColorInfo }>(
  candidates: T[],
  existingColors: ColorInfo[]
): T[] {
  const primaryColors = existingColors
    .map((c) => c.primary)
    .filter((c): c is string => !!c);

  if (primaryColors.length === 0) return candidates;

  return candidates.filter((item) => {
    const itemColor = item.colors?.primary;
    if (!itemColor) return true; // Unknown color, allow

    // Check compatibility with all existing colors
    return primaryColors.every((existing) => colorsAreCompatible(itemColor, existing));
  });
}

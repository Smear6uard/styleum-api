/**
 * Height-Based Silhouette Scoring Service
 * Adjusts item scores based on fit/length appropriateness for user height
 */

export type HeightCategory = "short" | "average" | "tall";
export type ItemFit = "oversized" | "relaxed" | "regular" | "fitted" | "slim";
export type ItemLength = "cropped" | "regular" | "longline";

interface HeightScoringContext {
  fit?: ItemFit | string | null;
  length?: ItemLength | string | null;
  category?: string | null;
  subcategory?: string | null;
}

// Category-based fit/length inference for items without explicit attributes
const CATEGORY_INFERRED_FIT: Record<string, ItemFit> = {
  // Typically oversized/relaxed
  hoodie: "relaxed",
  hoodies: "relaxed",
  sweater: "relaxed",
  sweaters: "relaxed",
  cardigan: "relaxed",
  cardigans: "relaxed",
  parka: "oversized",
  parkas: "oversized",
  // Typically fitted
  "t-shirt": "regular",
  "t-shirts": "regular",
  shirt: "regular",
  shirts: "regular",
  blouse: "fitted",
  blouses: "fitted",
  polo: "fitted",
  polos: "fitted",
  blazer: "fitted",
  blazers: "fitted",
  // Bottoms
  jeans: "regular",
  pants: "regular",
  trousers: "fitted",
  chinos: "fitted",
  joggers: "relaxed",
  leggings: "slim",
  shorts: "regular",
  skirt: "fitted",
  skirts: "fitted",
};

const CATEGORY_INFERRED_LENGTH: Record<string, ItemLength> = {
  // Cropped items
  "crop top": "cropped",
  "cropped jacket": "cropped",
  shorts: "cropped",
  // Longline items
  coat: "longline",
  coats: "longline",
  "maxi skirt": "longline",
  "maxi dress": "longline",
  parka: "longline",
  parkas: "longline",
  // Regular length
  "t-shirt": "regular",
  shirt: "regular",
  jeans: "regular",
  pants: "regular",
};

/**
 * Infer fit from category if not explicitly set
 */
function inferFit(context: HeightScoringContext): ItemFit {
  if (context.fit && ["oversized", "relaxed", "regular", "fitted", "slim"].includes(context.fit)) {
    return context.fit as ItemFit;
  }

  const category = (context.subcategory || context.category || "").toLowerCase();
  return CATEGORY_INFERRED_FIT[category] || "regular";
}

/**
 * Infer length from category if not explicitly set
 */
function inferLength(context: HeightScoringContext): ItemLength {
  if (context.length && ["cropped", "regular", "longline"].includes(context.length)) {
    return context.length as ItemLength;
  }

  const category = (context.subcategory || context.category || "").toLowerCase();
  return CATEGORY_INFERRED_LENGTH[category] || "regular";
}

/**
 * Get height-based silhouette boost for an item
 * Returns a value between -0.15 and +0.15 to adjust item scoring
 *
 * Height styling principles:
 * - Short: Favor streamlined silhouettes, vertical lines, avoid overwhelming pieces
 * - Average: Most silhouettes work well
 * - Tall: Can carry oversized/longline pieces confidently
 */
export function getHeightSilhouetteBoost(
  heightCategory: HeightCategory | null | undefined,
  context: HeightScoringContext
): number {
  if (!heightCategory) return 0;

  const fit = inferFit(context);
  const length = inferLength(context);

  // Average height: neutral, no adjustments
  if (heightCategory === "average") {
    return 0;
  }

  // Short height: favor streamlined, penalize oversized/longline
  if (heightCategory === "short") {
    let boost = 0;

    // Fit scoring for short users
    switch (fit) {
      case "fitted":
      case "slim":
        boost += 0.10; // Elongating, streamlined
        break;
      case "regular":
        boost += 0.02; // Neutral, slightly positive
        break;
      case "relaxed":
        boost -= 0.05; // Can overwhelm smaller frames
        break;
      case "oversized":
        boost -= 0.12; // Can make proportions look off
        break;
    }

    // Length scoring for short users
    switch (length) {
      case "cropped":
        boost += 0.08; // Shows more leg/body, elongating effect
        break;
      case "regular":
        boost += 0.02; // Standard, works well
        break;
      case "longline":
        boost -= 0.10; // Can overwhelm, shorten appearance
        break;
    }

    return Math.max(-0.15, Math.min(0.15, boost));
  }

  // Tall height: can carry oversized/longline well
  if (heightCategory === "tall") {
    let boost = 0;

    // Fit scoring for tall users
    switch (fit) {
      case "oversized":
        boost += 0.08; // Tall frames carry this well
        break;
      case "relaxed":
        boost += 0.05; // Works great
        break;
      case "regular":
        boost += 0.02; // Standard, always works
        break;
      case "fitted":
      case "slim":
        boost += 0.0; // Works but no special advantage
        break;
    }

    // Length scoring for tall users
    switch (length) {
      case "longline":
        boost += 0.08; // Proportionate on tall frames
        break;
      case "regular":
        boost += 0.02; // Standard
        break;
      case "cropped":
        boost += 0.0; // Works but shows a lot of leg
        break;
    }

    return Math.max(-0.15, Math.min(0.15, boost));
  }

  return 0;
}

/**
 * Calculate aggregate height silhouette boost for an entire outfit
 */
export function calculateOutfitHeightBoost(
  heightCategory: HeightCategory | null | undefined,
  items: HeightScoringContext[]
): number {
  if (!heightCategory || items.length === 0) return 0;

  const totalBoost = items.reduce(
    (sum, item) => sum + getHeightSilhouetteBoost(heightCategory, item),
    0
  );

  return totalBoost / items.length;
}

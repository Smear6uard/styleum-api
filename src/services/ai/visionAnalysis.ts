import Replicate from "replicate";

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;

if (!REPLICATE_API_TOKEN) {
  console.warn("REPLICATE_API_TOKEN not set - vision analysis disabled");
}

export interface VisionAnalysisResult {
  raw_description: string;
  extracted_colors: string[];
  extracted_patterns: string[];
  extracted_materials: string[];
  extracted_style: string[];
}

// Common color keywords for extraction
const COLOR_KEYWORDS = [
  "black", "white", "gray", "grey", "red", "blue", "green", "yellow", "orange",
  "purple", "pink", "brown", "beige", "cream", "ivory", "navy", "burgundy",
  "maroon", "olive", "teal", "coral", "salmon", "lavender", "mint", "turquoise",
  "gold", "silver", "bronze", "copper", "charcoal", "khaki", "tan", "camel",
  "rust", "wine", "plum", "sage", "forest", "emerald", "cobalt", "indigo",
  "magenta", "fuchsia", "peach", "rose", "mauve", "taupe", "slate", "denim"
];

// Pattern keywords
const PATTERN_KEYWORDS = [
  "solid", "striped", "stripes", "plaid", "checkered", "checked", "floral",
  "geometric", "abstract", "animal", "leopard", "zebra", "camo", "camouflage",
  "tie-dye", "polka dot", "dots", "houndstooth", "herringbone", "paisley",
  "argyle", "gingham", "tartan", "botanical", "tropical", "graphic", "print"
];

// Material keywords
const MATERIAL_KEYWORDS = [
  "cotton", "denim", "silk", "wool", "leather", "linen", "polyester", "nylon",
  "velvet", "suede", "satin", "chiffon", "cashmere", "tweed", "corduroy",
  "jersey", "fleece", "knit", "woven", "mesh", "lace", "canvas", "chambray",
  "rayon", "viscose", "spandex", "lycra", "synthetic", "organic", "recycled"
];

// Style keywords
const STYLE_KEYWORDS = [
  "casual", "formal", "sporty", "athletic", "bohemian", "boho", "minimalist",
  "classic", "vintage", "retro", "modern", "contemporary", "elegant", "chic",
  "streetwear", "urban", "preppy", "edgy", "romantic", "feminine", "masculine",
  "relaxed", "fitted", "oversized", "cropped", "tailored", "structured", "loose"
];

/**
 * Extract keywords from text that match a given list
 */
function extractKeywords(text: string, keywords: string[]): string[] {
  const lowerText = text.toLowerCase();
  const found: string[] = [];

  for (const keyword of keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      found.push(keyword);
    }
  }

  return [...new Set(found)]; // Remove duplicates
}

/**
 * Analyze a clothing image using Florence-2 Large on Replicate
 * @param imageUrl - URL of the image to analyze (should be processed/bg-removed)
 * @returns Structured vision analysis result
 */
export async function analyzeWithFlorence(
  imageUrl: string
): Promise<VisionAnalysisResult> {
  if (!REPLICATE_API_TOKEN) {
    throw new Error("REPLICATE_API_TOKEN not configured");
  }

  const replicate = new Replicate({ auth: REPLICATE_API_TOKEN });

  const prompt = `<DETAILED_CAPTION>
Analyze this clothing item in detail. Describe:
- Primary and secondary colors (use specific color names)
- Pattern type (solid, striped, plaid, floral, geometric, abstract, etc.)
- Material/fabric appearance (cotton, denim, silk, wool, leather, synthetic, etc.)
- Style attributes (casual, formal, sporty, bohemian, minimalist, etc.)
- Fit type if discernible (slim, regular, oversized, cropped, etc.)
- Notable design elements (buttons, zippers, pockets, embellishments, etc.)`;

  console.log(`[AI] Calling Florence-2 for vision analysis`);

  const output = await replicate.run(
    "lucataco/florence-2-large:f59f69cdc1fd14f2bbae2c8e0bc19de4516988ad6e04a128e2bbf1fc02a4dcbb",
    {
      input: {
        image: imageUrl,
        task_type: "detailed_caption",
      },
    }
  );

  // Florence-2 returns the caption in the output
  let caption = "";
  if (typeof output === "string") {
    caption = output;
  } else if (output && typeof output === "object") {
    // Handle potential object response
    caption = JSON.stringify(output);
  }

  if (!caption) {
    throw new Error("Florence-2 did not return a caption");
  }

  console.log(`[AI] Florence-2 caption: ${caption.substring(0, 100)}...`);

  // Extract structured data from the caption
  return {
    raw_description: caption,
    extracted_colors: extractKeywords(caption, COLOR_KEYWORDS),
    extracted_patterns: extractKeywords(caption, PATTERN_KEYWORDS),
    extracted_materials: extractKeywords(caption, MATERIAL_KEYWORDS),
    extracted_style: extractKeywords(caption, STYLE_KEYWORDS),
  };
}

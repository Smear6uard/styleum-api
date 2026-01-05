const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.warn("OPENROUTER_API_KEY not set - item tagging disabled");
}

export interface ItemTags {
  category: string;
  subcategory: string;
  colors: {
    primary: string;
    secondary: string[];
    accent: string[];
  };
  pattern: string;
  materials: string[];
  occasions: string[];
  seasons: string[];
  formality_score: number;
  style_vibes: string[];
  brand: string | null;
}

const PRIMARY_MODEL = "google/gemini-2.0-flash-001";
const FALLBACK_MODELS = [
  "google/gemini-2.0-flash-lite-001",
  "meta-llama/llama-3.3-70b-instruct",
  "anthropic/claude-3-haiku",
];
const MAX_RETRIES = 3;
const TIMEOUT_MS = 30000;

const SYSTEM_PROMPT = `You are a fashion AI assistant. Analyze clothing items and return structured JSON.
Output ONLY valid JSON with this exact schema:
{
  "category": "tops|bottoms|shoes|outerwear|accessories|bags|jewelry",
  "subcategory": "string (e.g., 't-shirt', 'jeans', 'sneakers')",
  "colors": {
    "primary": "string",
    "secondary": ["string"],
    "accent": ["string"]
  },
  "pattern": "solid|striped|plaid|floral|geometric|abstract|animal|camo|tie-dye|other",
  "materials": ["string"],
  "occasions": ["casual", "work", "formal", "athletic", "date", "party"],
  "seasons": ["spring", "summer", "fall", "winter"],
  "formality_score": 1-10,
  "style_vibes": ["minimalist", "streetwear", "preppy", "bohemian", "classic", "edgy", "romantic", "sporty"],
  "brand": "string (if visible, else null)"
}

Rules:
- category MUST be one of: tops, bottoms, shoes, outerwear, accessories, bags, jewelry
- formality_score MUST be an integer from 1 (very casual) to 10 (very formal)
- occasions and seasons should include ALL that apply
- style_vibes should include 1-3 that best describe the item
- Output ONLY the JSON object, no markdown, no explanation`;

/**
 * Parse JSON from a potentially messy LLM response
 */
function parseJsonResponse(content: string): ItemTags {
  // Try to extract JSON from markdown code blocks
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[1].trim());
  }

  // Try direct parse
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  throw new Error("Could not parse JSON from response");
}

/**
 * Create default tags as fallback
 */
function createDefaultTags(colors: string[]): ItemTags {
  return {
    category: "tops",
    subcategory: "unknown",
    colors: {
      primary: colors[0] || "unknown",
      secondary: colors.slice(1, 3),
      accent: [],
    },
    pattern: "solid",
    materials: [],
    occasions: ["casual"],
    seasons: ["spring", "summer", "fall", "winter"],
    formality_score: 5,
    style_vibes: ["casual"],
    brand: null,
  };
}

/**
 * Tag a clothing item using Gemini via OpenRouter
 * @param caption - Raw description from vision analysis
 * @param colors - Extracted color keywords
 * @returns Structured item tags
 */
export async function tagWithGemini(
  caption: string,
  colors: string[]
): Promise<ItemTags> {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const userMessage = `Analyze this clothing item and return the JSON:

Description: ${caption}

Detected colors: ${colors.length > 0 ? colors.join(", ") : "not detected"}

Remember: Output ONLY valid JSON, no other text.`;

  const allModels = [PRIMARY_MODEL, ...FALLBACK_MODELS];

  for (const model of allModels) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(
          `[AI] Trying ${model} (attempt ${attempt + 1}/${MAX_RETRIES})`
        );

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://styleum.app",
              "X-Title": "Styleum",
            },
            body: JSON.stringify({
              model,
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userMessage },
              ],
              temperature: 0.3,
              max_tokens: 1000,
            }),
            signal: controller.signal,
          }
        );

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          console.warn(`[AI] ${model} returned ${response.status}: ${errorText}`);
          continue;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
          console.warn(`[AI] ${model} returned empty content`);
          continue;
        }

        const tags = parseJsonResponse(content);

        // Validate required fields
        if (!tags.category || !tags.subcategory) {
          console.warn(`[AI] ${model} returned invalid tags structure`);
          continue;
        }

        console.log(`[AI] Successfully tagged with ${model}`);
        return tags;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        console.warn(`[AI] ${model} attempt ${attempt + 1} failed: ${errorMessage}`);

        // Don't retry on abort (timeout)
        if (err instanceof Error && err.name === "AbortError") {
          console.warn(`[AI] ${model} timed out, trying next model`);
          break;
        }
      }
    }
  }

  // All models failed - return default tags
  console.error("[AI] All tagging models failed, using defaults");
  return createDefaultTags(colors);
}

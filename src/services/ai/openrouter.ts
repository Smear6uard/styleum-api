/**
 * OpenRouter API Client
 * Reusable service for calling LLMs via OpenRouter with fallback support
 */

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.warn("OPENROUTER_API_KEY not set - LLM features will be disabled");
}

// Primary model for outfit composition
const PRIMARY_MODEL = "google/gemini-2.5-flash-lite";

// Fallback chain if primary fails
const FALLBACK_MODELS = [
  "google/gemini-2.0-flash-001",
  "meta-llama/llama-3.3-70b-instruct",
];

const MAX_RETRIES = 3;
const TIMEOUT_MS = 30000;

export interface OpenRouterMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface OpenRouterRequest {
  model?: string;
  messages: OpenRouterMessage[];
  max_tokens?: number;
  temperature?: number;
}

interface OpenRouterResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

/**
 * Call OpenRouter API with a specific model
 */
export async function callOpenRouter(request: OpenRouterRequest): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const model = request.model || PRIMARY_MODEL;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://styleum.app",
        "X-Title": "Styleum",
      },
      body: JSON.stringify({
        model,
        messages: request.messages,
        max_tokens: request.max_tokens || 2000,
        temperature: request.temperature || 0.7,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as OpenRouterResponse;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      throw new Error("OpenRouter returned empty content");
    }

    return content;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`OpenRouter request timed out after ${TIMEOUT_MS}ms`);
    }

    throw err;
  }
}

/**
 * Call OpenRouter with automatic fallback to alternative models
 */
export async function callOpenRouterWithFallback(
  messages: OpenRouterMessage[],
  options?: {
    max_tokens?: number;
    temperature?: number;
  }
): Promise<string> {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY not configured");
  }

  const allModels = [PRIMARY_MODEL, ...FALLBACK_MODELS];

  for (const model of allModels) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        console.log(`[OpenRouter] Trying ${model} (attempt ${attempt + 1}/${MAX_RETRIES})`);

        const response = await callOpenRouter({
          model,
          messages,
          max_tokens: options?.max_tokens,
          temperature: options?.temperature,
        });

        console.log(`[OpenRouter] Success with ${model}`);
        return response;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        console.warn(`[OpenRouter] ${model} attempt ${attempt + 1} failed: ${errorMessage}`);

        // Don't retry on timeout, move to next model
        if (err instanceof Error && err.message.includes("timed out")) {
          console.warn(`[OpenRouter] ${model} timed out, trying next model`);
          break;
        }
      }
    }
  }

  throw new Error("All OpenRouter models failed");
}

/**
 * Check if OpenRouter is available
 */
export function isOpenRouterAvailable(): boolean {
  return !!OPENROUTER_API_KEY;
}

/**
 * Parse JSON from a potentially messy LLM response
 * Handles markdown code blocks and extra text
 */
export function parseJsonFromLLMResponse<T>(content: string): T {
  // Try to extract JSON from markdown code blocks
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[1].trim());
  }

  // Try direct parse if it looks like JSON
  const trimmed = content.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }

  // Try to find JSON object in the response
  const objectMatch = content.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    return JSON.parse(objectMatch[0]);
  }

  throw new Error("Could not parse JSON from LLM response");
}

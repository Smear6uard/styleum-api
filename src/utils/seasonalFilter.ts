/**
 * Seasonal Filter Utility
 * Applies seasonal scoring/decay to outfit items based on weather
 */

import type { SeasonSuggestion, WeatherData } from "../services/weather.js";

// Season compatibility weights
// Key: current weather season, Value: item season -> weight
const SEASON_WEIGHTS: Record<SeasonSuggestion, Record<string, number>> = {
  summer: {
    summer: 1.0,
    spring: 0.7,
    fall: 0.3,
    winter: 0.1,
    all: 0.9,
  },
  spring: {
    spring: 1.0,
    summer: 0.6,
    fall: 0.6,
    winter: 0.3,
    all: 0.9,
  },
  fall: {
    fall: 1.0,
    spring: 0.6,
    winter: 0.7,
    summer: 0.3,
    all: 0.9,
  },
  winter: {
    winter: 1.0,
    fall: 0.7,
    spring: 0.4,
    summer: 0.1,
    all: 0.8,
  },
  all: {
    summer: 0.9,
    spring: 0.9,
    fall: 0.9,
    winter: 0.9,
    all: 1.0,
  },
};

// Formality adjustments based on temperature
// Higher temps -> prefer more casual, lower temps -> allow more formal
const TEMP_FORMALITY_ADJUSTMENT: Record<string, { min: number; max: number }> = {
  hot: { min: 1, max: 5 }, // > 28C: casual only
  warm: { min: 1, max: 7 }, // 22-28C: casual to smart casual
  mild: { min: 1, max: 10 }, // 15-22C: all formalities
  cool: { min: 2, max: 10 }, // 5-15C: avoid very casual
  cold: { min: 3, max: 10 }, // < 5C: prefer more covered/formal
};

export interface WardrobeItem {
  id: string;
  seasons?: string[] | null;
  formality_score?: number | null;
  category?: string | null;
  embedding?: number[] | null;
  colors?: {
    primary?: string | null;
    secondary?: string[] | null;
    accent?: string | null;
  } | null;
}

export interface ScoredItem extends WardrobeItem {
  seasonal_score: number;
  weather_appropriate: boolean;
}

/**
 * Get temperature category
 */
function getTempCategory(tempC: number): keyof typeof TEMP_FORMALITY_ADJUSTMENT {
  if (tempC >= 28) return "hot";
  if (tempC >= 22) return "warm";
  if (tempC >= 15) return "mild";
  if (tempC >= 5) return "cool";
  return "cold";
}

/**
 * Calculate seasonal score for an item
 */
export function calculateSeasonalScore(
  item: WardrobeItem,
  weatherSeason: SeasonSuggestion
): number {
  const itemSeasons = item.seasons || [];

  if (itemSeasons.length === 0) {
    // No season specified, neutral score
    return 0.8;
  }

  // Get best matching season weight
  let maxWeight = 0;
  for (const season of itemSeasons) {
    const seasonLower = season.toLowerCase();
    const weight = SEASON_WEIGHTS[weatherSeason]?.[seasonLower] ?? 0.5;
    maxWeight = Math.max(maxWeight, weight);
  }

  return maxWeight;
}

/**
 * Check if item formality is appropriate for weather
 */
export function isFormaltiyAppropriate(
  formality: number | null | undefined,
  tempC: number
): boolean {
  if (formality === null || formality === undefined) return true;

  const category = getTempCategory(tempC);
  const range = TEMP_FORMALITY_ADJUSTMENT[category];

  return formality >= range.min && formality <= range.max;
}

/**
 * Filter and score items based on weather
 */
export function filterByWeather(
  items: WardrobeItem[],
  weather: WeatherData
): ScoredItem[] {
  return items.map((item) => {
    const seasonalScore = calculateSeasonalScore(item, weather.season_suggestion);
    const formalityOk = isFormaltiyAppropriate(item.formality_score, weather.temperature);

    // Rain/snow penalty for certain categories
    let weatherPenalty = 0;
    if (weather.is_rainy || weather.is_snowy) {
      const category = item.category?.toLowerCase() || "";
      // Suede, linen, silk are bad in rain/snow
      if (["suede", "linen", "silk"].some((m) => category.includes(m))) {
        weatherPenalty = 0.3;
      }
    }

    return {
      ...item,
      seasonal_score: Math.max(0, seasonalScore - weatherPenalty),
      weather_appropriate: formalityOk && seasonalScore >= 0.5,
    };
  });
}

/**
 * Sort items by seasonal appropriateness
 */
export function sortBySeasonalFit(items: ScoredItem[]): ScoredItem[] {
  return [...items].sort((a, b) => {
    // Weather appropriate first
    if (a.weather_appropriate !== b.weather_appropriate) {
      return a.weather_appropriate ? -1 : 1;
    }
    // Then by seasonal score
    return b.seasonal_score - a.seasonal_score;
  });
}

/**
 * Get appropriate categories for weather conditions
 */
export function getWeatherCategories(weather: WeatherData): {
  required: string[];
  preferred: string[];
  avoid: string[];
} {
  const result = {
    required: [] as string[],
    preferred: [] as string[],
    avoid: [] as string[],
  };

  // Temperature-based
  if (weather.temperature < 10) {
    result.preferred.push("outerwear", "coats", "jackets", "sweaters");
    result.avoid.push("shorts", "tank tops", "sandals");
  } else if (weather.temperature > 25) {
    result.preferred.push("t-shirts", "shorts", "sandals", "dresses");
    result.avoid.push("coats", "heavy jackets", "sweaters");
  }

  // Rain/snow
  if (weather.is_rainy) {
    result.required.push("rain jacket", "umbrella", "waterproof");
    result.avoid.push("suede", "canvas sneakers");
  }

  if (weather.is_snowy) {
    result.required.push("boots", "warm coat");
    result.avoid.push("sneakers", "thin layers");
  }

  return result;
}

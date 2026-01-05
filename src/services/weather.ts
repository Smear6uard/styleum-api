/**
 * Weather Service - OpenWeatherMap Integration
 * Fetches current weather to influence outfit recommendations
 */

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const OPENWEATHER_BASE_URL = "https://api.openweathermap.org/data/2.5/weather";

export interface WeatherData {
  temperature: number; // Celsius
  feels_like: number;
  humidity: number;
  condition: WeatherCondition;
  description: string;
  wind_speed: number; // m/s
  is_rainy: boolean;
  is_snowy: boolean;
  season_suggestion: SeasonSuggestion;
}

export type WeatherCondition =
  | "clear"
  | "clouds"
  | "rain"
  | "drizzle"
  | "thunderstorm"
  | "snow"
  | "mist"
  | "fog";

export type SeasonSuggestion = "summer" | "fall" | "winter" | "spring" | "all";

/**
 * Map temperature to clothing season suggestion
 */
function getSeasonSuggestion(tempC: number, condition: WeatherCondition): SeasonSuggestion {
  // Adjust for rain/snow
  if (condition === "snow") return "winter";
  if (condition === "rain" || condition === "drizzle") {
    if (tempC < 10) return "fall";
    if (tempC < 20) return "spring";
  }

  // Temperature-based
  if (tempC < 5) return "winter";
  if (tempC < 15) return "fall";
  if (tempC < 22) return "spring";
  return "summer";
}

/**
 * Map OpenWeatherMap condition to our simplified condition
 */
function mapCondition(owmMain: string): WeatherCondition {
  const main = owmMain.toLowerCase();
  if (main === "clear") return "clear";
  if (main === "clouds") return "clouds";
  if (main === "rain") return "rain";
  if (main === "drizzle") return "drizzle";
  if (main === "thunderstorm") return "thunderstorm";
  if (main === "snow") return "snow";
  if (main === "mist" || main === "haze" || main === "smoke") return "mist";
  if (main === "fog") return "fog";
  return "clouds"; // default
}

/**
 * Fetch weather data by coordinates
 */
export async function getWeatherByCoords(
  lat: number,
  lon: number
): Promise<WeatherData | null> {
  if (!OPENWEATHER_API_KEY) {
    console.warn("[Weather] No API key configured, skipping weather fetch");
    return null;
  }

  try {
    const url = `${OPENWEATHER_BASE_URL}?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[Weather] API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    const condition = mapCondition(data.weather?.[0]?.main || "clouds");
    const temperature = data.main?.temp ?? 20;

    return {
      temperature,
      feels_like: data.main?.feels_like ?? temperature,
      humidity: data.main?.humidity ?? 50,
      condition,
      description: data.weather?.[0]?.description || "unknown",
      wind_speed: data.wind?.speed ?? 0,
      is_rainy: ["rain", "drizzle", "thunderstorm"].includes(condition),
      is_snowy: condition === "snow",
      season_suggestion: getSeasonSuggestion(temperature, condition),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Weather] Failed to fetch weather: ${msg}`);
    return null;
  }
}

/**
 * Fetch weather data by city name
 */
export async function getWeatherByCity(city: string): Promise<WeatherData | null> {
  if (!OPENWEATHER_API_KEY) {
    console.warn("[Weather] No API key configured, skipping weather fetch");
    return null;
  }

  try {
    const url = `${OPENWEATHER_BASE_URL}?q=${encodeURIComponent(city)}&appid=${OPENWEATHER_API_KEY}&units=metric`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`[Weather] API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    const condition = mapCondition(data.weather?.[0]?.main || "clouds");
    const temperature = data.main?.temp ?? 20;

    return {
      temperature,
      feels_like: data.main?.feels_like ?? temperature,
      humidity: data.main?.humidity ?? 50,
      condition,
      description: data.weather?.[0]?.description || "unknown",
      wind_speed: data.wind?.speed ?? 0,
      is_rainy: ["rain", "drizzle", "thunderstorm"].includes(condition),
      is_snowy: condition === "snow",
      season_suggestion: getSeasonSuggestion(temperature, condition),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[Weather] Failed to fetch weather: ${msg}`);
    return null;
  }
}

/**
 * Get default weather (neutral conditions)
 */
export function getDefaultWeather(): WeatherData {
  return {
    temperature: 20,
    feels_like: 20,
    humidity: 50,
    condition: "clear",
    description: "clear sky",
    wind_speed: 3,
    is_rainy: false,
    is_snowy: false,
    season_suggestion: "all",
  };
}

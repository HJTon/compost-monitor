import type { WeatherData, WeatherCondition } from '@/types';
import { WMO_CODE_MAP } from '@/utils/config';
import { cacheWeather, getCachedWeather } from './db';

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

function mapWMOCode(code: number): WeatherCondition {
  return (WMO_CODE_MAP[code] || 'Cloudy') as WeatherCondition;
}

export async function fetchWeather(lat: number, lon: number, date: string): Promise<WeatherData | null> {
  // Check cache first
  const cached = await getCachedWeather(date);
  if (cached) {
    const age = Date.now() - new Date(cached.fetchedAt).getTime();
    if (age < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  // Try fetching from our Netlify proxy (avoids CORS)
  try {
    const res = await fetch(`/.netlify/functions/compost-weather?lat=${lat}&lon=${lon}`);
    if (!res.ok) throw new Error(`Weather API error: ${res.status}`);
    const data = await res.json();

    const weatherData: WeatherData = {
      condition: mapWMOCode(data.current.weather_code),
      weatherCode: data.current.weather_code,
      currentTemp: Math.round(data.current.temperature_2m),
      minTemp: Math.round(data.daily.temperature_2m_min[0]),
      maxTemp: Math.round(data.daily.temperature_2m_max[0]),
    };

    // Cache it
    await cacheWeather({
      id: date,
      data: weatherData,
      fetchedAt: new Date().toISOString(),
    });

    return weatherData;
  } catch (err) {
    console.warn('Failed to fetch weather:', err);

    // Return stale cache if available
    if (cached) {
      return cached.data;
    }

    return null;
  }
}

import type { Context } from '@netlify/functions';

// Server-side cache (persists across warm invocations)
let weatherCache: { data: unknown; timestamp: number; key: string } | null = null;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export default async (request: Request, _context: Context) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  try {
    const url = new URL(request.url);
    const lat = url.searchParams.get('lat') || '-39.06';
    const lon = url.searchParams.get('lon') || '174.08';
    const cacheKey = `${lat},${lon}`;

    // Check server-side cache
    if (weatherCache && weatherCache.key === cacheKey && (Date.now() - weatherCache.timestamp) < CACHE_TTL) {
      return new Response(JSON.stringify(weatherCache.data), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=1800',
        },
      });
    }

    const apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=Pacific/Auckland&forecast_days=1`;

    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Open-Meteo API returned ${response.status}`);
    }

    const data = await response.json();

    // Cache the result
    weatherCache = { data, timestamp: Date.now(), key: cacheKey };

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=1800',
      },
    });
  } catch (error) {
    console.error('Weather API error:', error);
    return new Response(JSON.stringify({
      error: 'Failed to fetch weather',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
};

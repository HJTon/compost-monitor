import type { Context } from '@netlify/functions';

// Server-side cache keyed by (lat, lon, date). Historical responses never
// change so they're cached forever (in-memory for as long as the function
// container lives). "Today" responses use a short TTL.
interface CacheEntry { data: unknown; timestamp: number; }
const cache = new Map<string, CacheEntry>();
const TODAY_TTL = 30 * 60 * 1000; // 30 min
const HIST_TTL = 365 * 24 * 60 * 60 * 1000; // effectively forever

function todayISO(): string {
  // NZ date for "today" classification
  const nz = new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' });
  // en-NZ gives dd/mm/yyyy, hh:mm:ss — normalise to yyyy-mm-dd
  const m = nz.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return new Date().toISOString().slice(0, 10);
  const dd = m[1].padStart(2, '0');
  const mm = m[2].padStart(2, '0');
  return `${m[3]}-${mm}-${dd}`;
}

function normaliseDate(raw: string | null): string | null {
  if (!raw) return null;
  // Accept YYYY-MM-DD or DD/MM/YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

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
    const lat = url.searchParams.get('lat') || '-39.18598';
    const lon = url.searchParams.get('lon') || '174.078433';
    const date = normaliseDate(url.searchParams.get('date')); // optional
    const today = todayISO();
    const isToday = !date || date === today;
    const targetDate = date || today;

    const cacheKey = `${lat},${lon},${targetDate}`;
    const cached = cache.get(cacheKey);
    const ttl = isToday ? TODAY_TTL : HIST_TTL;
    if (cached && (Date.now() - cached.timestamp) < ttl) {
      return new Response(JSON.stringify(cached.data), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': isToday ? 'public, max-age=1800' : 'public, max-age=31536000',
        },
      });
    }

    let apiUrl: string;
    if (isToday) {
      // Live forecast — gives current temp + today's daily min/max
      apiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=Pacific/Auckland&forecast_days=1`;
    } else {
      // Historical — use Open-Meteo's historical-forecast-api which has
      // low-latency reanalysis going back several years. Returns the same
      // schema as the live forecast (minus `current`).
      apiUrl = `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=Pacific/Auckland&start_date=${targetDate}&end_date=${targetDate}`;
    }

    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new Error(`Open-Meteo returned ${response.status}`);
    }
    const data: {
      current?: { temperature_2m: number; weather_code: number };
      daily?: {
        temperature_2m_max: (number | null)[];
        temperature_2m_min: (number | null)[];
        weather_code: (number | null)[];
      };
    } = await response.json();

    // Normalise response so caller always gets the same shape it had before
    // (WeatherService reads data.current.weather_code, data.current.temperature_2m,
    // data.daily.temperature_2m_min[0], data.daily.temperature_2m_max[0]).
    if (!isToday) {
      const dailyMax = data.daily?.temperature_2m_max?.[0] ?? null;
      const dailyMin = data.daily?.temperature_2m_min?.[0] ?? null;
      const wcode = data.daily?.weather_code?.[0] ?? 1;
      // Use daily max as a stand-in for "current" (no real current temp for
      // historical dates) — weatherService.currentTemp isn't written to the
      // sheet so this is only for display fallback.
      data.current = {
        temperature_2m: dailyMax ?? dailyMin ?? 0,
        weather_code: wcode,
      };
    }

    cache.set(cacheKey, { data, timestamp: Date.now() });

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': isToday ? 'public, max-age=1800' : 'public, max-age=31536000',
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

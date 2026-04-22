import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

// Rewrites the Ambient Min (col D) and Ambient Max (col E) columns on every
// compost system tab using Open-Meteo historical reanalysis. Values are written
// in °C (matches existing storage convention).
//
// Usage:
//   POST /.netlify/functions/compost-backfill-ambient
//   Body: { lat?, lon?, dryRun?: boolean, overwrite?: boolean }
//   Defaults: lat=-39.18598, lon=174.078433, overwrite=true

const EXCLUDED_TABS = new Set([
  'bin tracker', 'system setup', 'score card', 'scorecard', 'template',
  'build info', 'build phases', 'sampling log', 'media',
]);

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

function parseSheetDate(raw: string): string | null {
  // Sheet stores dates as DD/MM/YYYY (or D/M/YYYY)
  const m = (raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function todayISO(): string {
  const nz = new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' });
  const m = nz.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return new Date().toISOString().slice(0, 10);
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

async function fetchArchive(
  lat: number, lon: number, startDate: string, endDate: string,
): Promise<Map<string, { min: number | null; max: number | null }>> {
  const url = `https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min&timezone=Pacific/Auckland&start_date=${startDate}&end_date=${endDate}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo historical-forecast returned ${res.status}`);
  const data: {
    daily?: {
      time?: string[];
      temperature_2m_max?: (number | null)[];
      temperature_2m_min?: (number | null)[];
    };
  } = await res.json();
  const times = data.daily?.time || [];
  const max = data.daily?.temperature_2m_max || [];
  const min = data.daily?.temperature_2m_min || [];
  const out = new Map<string, { min: number | null; max: number | null }>();
  for (let i = 0; i < times.length; i++) {
    out.set(times[i], { min: min[i] ?? null, max: max[i] ?? null });
  }
  return out;
}

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
  }

  try {
    const spreadsheetId = process.env.COMPOST_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return new Response(JSON.stringify({ error: 'Spreadsheet ID not configured' }), { status: 500 });
    }

    let body: { lat?: number; lon?: number; dryRun?: boolean; overwrite?: boolean; tabs?: string[] } = {};
    try { body = await req.json(); } catch { /* empty body OK */ }
    const lat = body.lat ?? -39.18598;
    const lon = body.lon ?? 174.078433;
    const dryRun = body.dryRun === true;
    const overwrite = body.overwrite !== false; // default true

    const sheets = getGoogleSheetsClient();

    // List all candidate tabs
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    let allTabs = (meta.data.sheets || [])
      .map(s => s.properties?.title as string)
      .filter(Boolean)
      .filter(t => !EXCLUDED_TABS.has(t.toLowerCase().trim()));
    if (body.tabs && body.tabs.length > 0) {
      const want = new Set(body.tabs.map(t => t.trim()));
      allTabs = allTabs.filter(t => want.has(t.trim()));
    }

    if (allTabs.length === 0) {
      return new Response(JSON.stringify({ error: 'No matching tabs found' }), { status: 404 });
    }

    // Read cols A-E for every tab in one batch (date + ambient min/max)
    const ranges = allTabs.map(t => `'${t}'!A1:E5000`);
    const batch = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
    const values = batch.data.valueRanges || [];

    // Build per-tab row plan + collect date range
    interface Plan { tab: string; rowIndex: number; isoDate: string; existingMin: string; existingMax: string; }
    const plans: Plan[] = [];
    let minDate: string | null = null;
    let maxDate: string | null = null;
    const today = todayISO();

    for (let i = 0; i < allTabs.length; i++) {
      const tab = allTabs[i];
      const rows = (values[i]?.values || []) as string[][];
      // Find header row: first row where col A doesn't parse as date (allow up to row 5)
      let startRow = 0;
      for (let r = 0; r < Math.min(5, rows.length); r++) {
        const iso = parseSheetDate(rows[r]?.[0] || '');
        if (iso) { startRow = r; break; }
        startRow = r + 1;
      }
      for (let r = startRow; r < rows.length; r++) {
        const row = rows[r] || [];
        const iso = parseSheetDate(row[0] || '');
        if (!iso) continue;
        if (iso > today) continue; // safety: skip any future-dated rows
        plans.push({
          tab,
          rowIndex: r, // 0-based → spreadsheet row = r+1
          isoDate: iso,
          existingMin: (row[3] || '').trim(),
          existingMax: (row[4] || '').trim(),
        });
        if (!minDate || iso < minDate) minDate = iso;
        if (!maxDate || iso > maxDate) maxDate = iso;
      }
    }

    if (plans.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: 'No dated rows found', tabs: allTabs }));
    }

    // Fetch historical weather once for the full date range
    const weatherMap = await fetchArchive(lat, lon, minDate!, maxDate!);

    // Build updates
    interface Update { range: string; values: [[string | number, string | number]]; }
    const updates: Update[] = [];
    let wouldWrite = 0;
    let skippedExisting = 0;
    let missingWeather = 0;

    for (const p of plans) {
      const w = weatherMap.get(p.isoDate);
      if (!w || (w.min == null && w.max == null)) { missingWeather++; continue; }
      if (!overwrite && (p.existingMin !== '' || p.existingMax !== '')) {
        skippedExisting++;
        continue;
      }
      const minOut = w.min != null ? Math.round(w.min * 10) / 10 : '';
      const maxOut = w.max != null ? Math.round(w.max * 10) / 10 : '';
      updates.push({
        range: `'${p.tab}'!D${p.rowIndex + 1}:E${p.rowIndex + 1}`,
        values: [[minOut, maxOut]],
      });
      wouldWrite++;
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true, dryRun: true,
        tabsScanned: allTabs.length,
        rowsFound: plans.length,
        wouldWrite, skippedExisting, missingWeather,
        dateRange: { start: minDate, end: maxDate },
        sampleUpdates: updates.slice(0, 5),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Batch-update (Sheets API max 10000 per request but we chunk to be safe)
    const CHUNK = 1000;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: chunk.map(u => ({ range: u.range, values: u.values })),
        },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      tabsScanned: allTabs.length,
      rowsFound: plans.length,
      wrote: wouldWrite,
      skippedExisting, missingWeather,
      dateRange: { start: minDate, end: maxDate },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err) {
    console.error('Backfill error:', err);
    return new Response(JSON.stringify({
      error: 'Backfill failed',
      details: err instanceof Error ? err.message : String(err),
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

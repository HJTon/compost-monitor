import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

// ─── Composition weights ──────────────────────────────────────────────────────
// 3:2:1 ratio for primary : secondary : tertiary source.
// When fill-level data is available in future, replace these static weights
// with actual fill proportions per bin and the rest of the logic stays the same.
const CONTENT_WEIGHTS = [3, 2, 1];

function getWeightsForSources(count: number): number[] {
  if (count === 0) return [];
  const weights = CONTENT_WEIGHTS.slice(0, count);
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map(w => w / total);
}

// ─── Google Sheets client ─────────────────────────────────────────────────────
function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

// ─── Handler ──────────────────────────────────────────────────────────────────
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
    const spreadsheetId = process.env.COMPOST_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return new Response(JSON.stringify({ error: 'Spreadsheet ID not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const systemName = url.searchParams.get('system');
    if (!systemName) {
      return new Response(JSON.stringify({ error: 'Missing ?system= parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sheets = getGoogleSheetsClient();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Bin Tracker',
    });

    const rows = response.data.values || [];
    const dataRows = rows.slice(1); // skip header

    // Accumulate weighted source contributions for this system
    // sourceTotals: { [sourceName]: totalWeight }
    const sourceTotals: Record<string, number> = {};
    let binCount = 0;

    for (const row of dataRows) {
      const rowSystem = (row[8] || '').toString().trim();
      if (rowSystem.toLowerCase() !== systemName.trim().toLowerCase()) continue;

      // Collect non-empty content sources from columns B, C, D (indices 1, 2, 3)
      const sources: string[] = [row[1], row[2], row[3]]
        .map(v => (v || '').toString().trim())
        .filter(v => v !== '');

      if (sources.length === 0) continue;

      const weights = getWeightsForSources(sources.length);
      binCount++;

      sources.forEach((source, i) => {
        // Normalise common variants
        const name = normaliseSource(source);
        sourceTotals[name] = (sourceTotals[name] || 0) + weights[i];
      });
    }

    // Convert totals to percentages
    const grandTotal = Object.values(sourceTotals).reduce((a, b) => a + b, 0);
    const composition = Object.entries(sourceTotals)
      .map(([source, weight]) => ({
        source,
        percentage: grandTotal > 0 ? Math.round((weight / grandTotal) * 100) : 0,
      }))
      .sort((a, b) => b.percentage - a.percentage);

    // Rounding can leave totals at 99/101 — nudge the largest to compensate
    const roundingDrift = 100 - composition.reduce((s, c) => s + c.percentage, 0);
    if (composition.length > 0) composition[0].percentage += roundingDrift;

    return new Response(JSON.stringify({
      success: true,
      system: systemName,
      binCount,
      composition,
      weights: CONTENT_WEIGHTS, // expose weights so UI can show methodology
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Error reading bin composition:', error);
    return new Response(JSON.stringify({
      error: 'Failed to read bin composition',
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

// ─── Source name normalisation ────────────────────────────────────────────────
// Cleans up minor typos and spacing differences in the raw sheet data.
// Extend this as new variants appear.
function normaliseSource(raw: string): string {
  const s = raw.trim();
  if (!s || s === '?') return 'Unknown';

  const lower = s.toLowerCase();
  if (lower.includes('juno')) return 'Juno Gin';
  if (lower.includes('novotel')) return 'Novotel';
  if (lower.includes('columbus')) return 'Columbus';
  if (lower.includes('food bank')) return 'Food Bank';
  if (lower.includes('salvation army')) return 'Salvation Army';
  if (lower.includes('toi foundation') || lower === 'toi') return 'Toi Foundation';
  if (lower.includes('altherm')) return 'Altherm';
  if (lower.includes('tumai') || lower.includes('tu mai')) return 'TuMai';
  if (lower.includes('hub')) return 'Hub Collection';
  if (lower.includes('a&p')) return 'A&P Stratford';
  if (lower.includes('holiday park')) return 'Holiday Park';
  if (lower.includes('life skills')) return 'Life Skills';
  if (lower.includes('venture taranaki')) return 'Venture Taranaki';
  if (lower.includes('wedding')) return 'Wedding';

  return s; // return as-is if no match — new sources appear automatically
}

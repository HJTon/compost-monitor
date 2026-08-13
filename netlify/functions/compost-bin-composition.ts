import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

// ─── Composition weights ──────────────────────────────────────────────────────
// Fallback only. Rows written before 2026-08-13 record which businesses fed a
// bin but not how much each contributed, so their share is estimated from the
// order the names happen to sit in — "first listed contributed most". That
// order is an artefact of the sequence things were assigned at the farm, not a
// measurement, which is why measured rows are preferred wherever they exist.
const CONTENT_WEIGHTS = [5, 4, 3, 2, 1];

function getWeightsForSources(count: number): number[] {
  if (count === 0) return [];
  // Rows can now carry more than 5 sources (col M overflow). Anything past the
  // declared ratio gets the smallest weight, and the whole set is normalised,
  // so a row always contributes exactly 1 regardless of how many fed it.
  const weights = Array.from(
    { length: count },
    (_, i) => CONTENT_WEIGHTS[i] ?? CONTENT_WEIGHTS[CONTENT_WEIGHTS.length - 1]
  );
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map(w => w / total);
}

// ─── Bin Tracker columns ──────────────────────────────────────────────────────
// Resolved from the header row where possible. Both apps have historically
// addressed this tab by fixed position, and a column inserted in April 2026
// silently corrupted every collector write until it was backfilled — so the
// positions below are a fallback, not the primary lookup.
const FALLBACK_COLS = {
  sources: [1, 2, 3, 4, 5],
  buildName: 10,
  overflowSources: 12,
  breakdownJson: 13,
};

function resolveColumns(header: string[]) {
  const norm = header.map(h => (h || '').toString().trim().toLowerCase());
  const findIdx = (match: (h: string) => boolean, fallback: number) => {
    const i = norm.findIndex(match);
    return i === -1 ? fallback : i;
  };

  const sources = norm.reduce<number[]>((acc, h, i) => {
    if (h === 'content from') acc.push(i);
    return acc;
  }, []);

  return {
    sources: sources.length > 0 ? sources : FALLBACK_COLS.sources,
    buildName: findIdx(h => h === 'batch', FALLBACK_COLS.buildName),
    overflowSources: findIdx(h => h.startsWith('content from 6'), FALLBACK_COLS.overflowSources),
    breakdownJson: findIdx(h => h.startsWith('source breakdown'), FALLBACK_COLS.breakdownJson),
  };
}

interface BreakdownEntry {
  name: string;
  bins?: number;
  buckets?: number;
  litres?: number;
}

/**
 * Measured share of one bin, by volume — a quarter-full bucket should not
 * count the same as a full wheelie bin.
 *
 * Returns weights summing to 1 so a measured row contributes exactly as much
 * to the build as an estimated one. Only the split *within* the row changes;
 * every bin still counts equally toward the pile, which is what the estimated
 * path has always done.
 */
function weightsFromBreakdown(raw: string): Array<{ name: string; weight: number }> | null {
  if (!raw || !raw.trim()) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  const entries = (parsed as BreakdownEntry[]).filter(
    e => e && typeof e.name === 'string' && e.name.trim() !== ''
  );
  if (entries.length === 0) return null;

  const totalLitres = entries.reduce((sum, e) => sum + (Number(e.litres) || 0), 0);

  // Everything recorded as empty (all bins at 0% fullness) — we still know the
  // true source list, so split evenly rather than falling back to the guess.
  if (totalLitres <= 0) {
    return entries.map(e => ({ name: e.name, weight: 1 / entries.length }));
  }

  return entries.map(e => ({
    name: e.name,
    weight: (Number(e.litres) || 0) / totalLitres,
  }));
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
    const cols = resolveColumns(rows[0] || []);
    const dataRows = rows.slice(1); // skip header

    // Accumulate weighted source contributions for this system
    // sourceTotals: { [sourceName]: totalWeight }
    const sourceTotals: Record<string, number> = {};
    let binCount = 0;
    let measuredBins = 0;
    let estimatedBins = 0;

    for (const row of dataRows) {
      const rowSystem = (row[cols.buildName] || '').toString().trim();
      if (rowSystem.toLowerCase() !== systemName.trim().toLowerCase()) continue;

      // Preferred: the per-source breakdown the collector app writes, which
      // knows how many bins/buckets each business contributed and how full
      // they were.
      const measured = weightsFromBreakdown((row[cols.breakdownJson] || '').toString());

      if (measured) {
        binCount++;
        measuredBins++;
        measured.forEach(({ name, weight }) => {
          const key = normaliseSource(name);
          sourceTotals[key] = (sourceTotals[key] || 0) + weight;
        });
        continue;
      }

      // Fallback for rows without a breakdown: the "Content from" columns,
      // plus any overflow names that used to be dropped entirely.
      const overflow = (row[cols.overflowSources] || '')
        .toString()
        .split(',')
        .map(v => v.trim())
        .filter(v => v !== '');

      const sources: string[] = [
        ...cols.sources.map(i => (row[i] || '').toString().trim()),
        ...overflow,
      ].filter(v => v !== '');

      if (sources.length === 0) continue;

      const weights = getWeightsForSources(sources.length);
      binCount++;
      estimatedBins++;

      sources.forEach((source, i) => {
        // Normalise common variants
        const name = normaliseSource(source);
        // getWeightsForSources only defines weights for the first 5; anything
        // beyond that gets the smallest weight rather than undefined.
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
      // How much of this build's composition is measured vs estimated from the
      // positional guess. Bins recorded before 2026-08-13 have no breakdown.
      measuredBins,
      estimatedBins,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        // Bin Tracker contents change rarely — cache at the edge for 5 min.
        'Netlify-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
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

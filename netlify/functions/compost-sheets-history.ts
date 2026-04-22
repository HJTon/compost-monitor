import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

interface ParsedEntry {
  date: string;
  time: string;
  weather: string;
  ambientMin: number | null;
  ambientMax: number | null;
  moisture: string;
  odour: string;
  probes: (number | null)[];
  average: number | null;
  peak: number | null;
  height: number | null;
  turn: boolean;
  sample: string;
  ventTemps: string;
  visualNotes: string;
  generalNotes: string;
  observations?: Record<string, number>;
}

const OBSERVATION_KEYS: Array<{ header: string; key: string }> = [
  { header: 'fruit flies', key: 'fruitFlies' },
  { header: 'flies',       key: 'flies' },
  { header: 'mites',       key: 'mites' },
  { header: 'birds',       key: 'birds' },
  { header: 'rats',        key: 'rats' },
  { header: 'ink caps',    key: 'inkyCaps' },
  { header: 'inky caps',   key: 'inkyCaps' }, // legacy spelling
  { header: 'mushrooms',   key: 'mushrooms' },
  { header: 'fungus',      key: 'fungus' },
  { header: 'seedlings',   key: 'seedlings' },
];

// Detect probe count from the header row by counting columns between
// the last fixed column (Odour, col index 6) and the Average column.
// Falls back to legacy hardcoded map, then to 9.
const LEGACY_PROBE_COUNT: Record<string, number> = {
  'Carbon Cube Cycle 1': 3,
  'Cylinder #1': 5,
  'Cylinder #2': 5,
  'Cylinder #3': 5,
};

function detectProbeCount(headerRow: string[], tabName: string): number {
  if (headerRow.length === 0) return LEGACY_PROBE_COUNT[tabName] || 9;
  const h = headerRow.map(c => c.toLowerCase().trim());
  // Find the "average" column — probes sit between column 7 (index 7) and average
  const avgIdx = h.findIndex(c => c.includes('averag'));
  if (avgIdx > 7) return avgIdx - 7;
  // If no average header found, try counting columns that look like probe headers
  // (numeric labels like "1", "2", "Probe 1", "Core Centre", etc.)
  // between index 7 and the first non-probe column
  const probeStart = 7;
  let count = 0;
  for (let i = probeStart; i < h.length; i++) {
    // Stop at known non-probe headers
    if (h[i].includes('averag') || h[i].includes('peak') || h[i].includes('vent') ||
        h[i].includes('visual') || h[i].includes('general') || h[i].includes('height') ||
        h[i].includes('turn') || h[i].includes('sample') || h[i].includes('media')) break;
    count++;
  }
  if (count > 0) return count;
  return LEGACY_PROBE_COUNT[tabName] || 9;
}

interface ColMap {
  avgCol: number;
  peakCol: number;
  heightCol: number | null;
  widthCol: number | null;
  lengthCol: number | null;
  turnCol: number | null;
  sampleCol: number | null;
  ventCol: number;
  visualCol: number;
  generalCol: number;
  /** Mapping of observation key → column indices (array so legacy+canonical columns can coexist during migration). Missing keys = column absent. */
  observationCols: Partial<Record<string, number[]>>;
}

function detectColumns(headerRow: string[], probeCount: number): ColMap {
  const h = headerRow.map(c => c.toLowerCase().trim());
  const find = (...terms: string[]) => h.findIndex(c => terms.some(t => c.includes(t)));

  const avgIdx = find('averag');
  const peakIdx = find('peak');

  // Fall back to calculated positions if headers not found
  const avgCol = avgIdx >= 0 ? avgIdx : 7 + probeCount;
  const peakCol = peakIdx >= 0 ? peakIdx : avgCol + 1;

  const heightIdx = find('height');
  const widthIdx = find('width');
  const lengthIdx = find('length', 'lenth'); // handle typo in some sheets
  const turnIdx = find('turn');
  const sampleIdx = find('sample');
  const ventIdx = find('vent');
  const visualIdx = find('visual');
  const generalIdx = find('general');

  // Some sheets (e.g. Pivot #3) have a single "Notes" column rather than
  // separate Visual/General Notes. If neither was found by name, look for a
  // standalone "note" column and route it to generalNotes. Never fall back to
  // positional offsets (e.g. peakCol+2) — some sheets have duplicated Peak Temp
  // columns from merged-cell headers that would otherwise be read as notes.
  let visualCol = visualIdx;
  let generalCol = generalIdx;
  if (generalCol < 0) {
    const noteIdx = h.findIndex((c, i) => i !== visualCol && c.includes('note'));
    if (noteIdx >= 0) generalCol = noteIdx;
  }

  // Observation columns — matched by header name. A tab may briefly carry
  // BOTH a canonical ("Ink Caps") and a legacy ("Inky Caps") column side-by-
  // side while data is being migrated, so we track every match and take the
  // max value at read time. First-match order in OBSERVATION_KEYS is the
  // preferred canonical, but values from all matches are merged.
  const observationCols: Partial<Record<string, number[]>> = {};
  for (const { header, key } of OBSERVATION_KEYS) {
    for (let i = 0; i < h.length; i++) {
      if (h[i] === header) {
        if (!observationCols[key]) observationCols[key] = [];
        if (!observationCols[key]!.includes(i)) observationCols[key]!.push(i);
      }
    }
  }

  return {
    avgCol,
    peakCol,
    heightCol: heightIdx >= 0 ? heightIdx : null,
    widthCol: widthIdx >= 0 ? widthIdx : null,
    lengthCol: lengthIdx >= 0 ? lengthIdx : null,
    turnCol: turnIdx >= 0 ? turnIdx : null,
    sampleCol: sampleIdx >= 0 ? sampleIdx : null,
    ventCol: ventIdx >= 0 ? ventIdx : peakCol + 1,
    visualCol,
    generalCol,
    observationCols,
  };
}

// Normalise a date cell to YYYY-MM-DD. Sheets sometimes return ISO,
// sometimes DD/MM/YYYY (NZ locale), sometimes D/M/YYYY. Unparseable values
// pass through so we never drop rows silently.
function normaliseDate(raw: string): string {
  const v = (raw || '').trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return v;
}

function parseRow(row: string[], probeCount: number, cols: ColMap): ParsedEntry {
  const parseNum = (val: string | undefined): number | null => {
    if (!val || val === '') return null;
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  };

  // Observations: read each column into an integer intensity. When multiple
  // columns map to the same key (canonical + legacy during migration), take
  // the max value so whichever column the data ended up in is surfaced.
  let observations: Record<string, number> | undefined;
  for (const [key, idxList] of Object.entries(cols.observationCols)) {
    if (!idxList || idxList.length === 0) continue;
    let best = 0;
    for (const idx of idxList) {
      const v = parseNum(row[idx]);
      if (v !== null && v > best) best = Math.round(v);
    }
    if (best > 0) {
      if (!observations) observations = {};
      observations[key] = best;
    }
  }

  const turnVal = cols.turnCol !== null ? (row[cols.turnCol] || '').trim().toLowerCase() : '';
  // Match "turn", "turn 1", "turn 2", "turns", "yes", "y", "true", or any non-empty value in the turn column
  const isTurn = turnVal !== '' && (turnVal.startsWith('turn') || turnVal === 'yes' || turnVal === 'y' || turnVal === 'true');
  const sampleVal = cols.sampleCol !== null ? (row[cols.sampleCol] || '').trim() : '';
  return {
    date: normaliseDate(row[0] || ''),
    time: row[1] || '',
    weather: row[2] || '',
    ambientMin: parseNum(row[3]),
    ambientMax: parseNum(row[4]),
    moisture: row[5] || '',
    odour: row[6] || '',
    probes: Array.from({ length: probeCount }, (_, i) => parseNum(row[7 + i])),
    average: parseNum(row[cols.avgCol]),
    peak: parseNum(row[cols.peakCol]),
    height: cols.heightCol !== null ? parseNum(row[cols.heightCol]) : null,
    turn: isTurn,
    sample: sampleVal,
    ventTemps: row[cols.ventCol] || '',
    visualNotes: row[cols.visualCol] || '',
    generalNotes: row[cols.generalCol] || '',
    observations,
  };
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
    const spreadsheetId = process.env.COMPOST_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return new Response(JSON.stringify({ error: 'Spreadsheet ID not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const tab = url.searchParams.get('tab');
    const limit = parseInt(url.searchParams.get('limit') || '30');

    if (!tab) {
      return new Response(JSON.stringify({ error: 'Missing ?tab= parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tab}'`,
    });

    const rows = response.data.values || [];

    // Scan first 5 rows to find the actual header row (may be preceded by a title row like "Pivot #3")
    const HEADER_KEYWORDS = ['date', 'time', 'weather', 'averag', 'peak', 'height', 'moisture', 'probe', 'odour', 'ambient'];
    let headerRowIndex = -1;
    let headerRow: string[] = [];
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const rowLower = (rows[i] || []).map((c: string) => c.toLowerCase().trim());
      const matches = rowLower.filter(c => HEADER_KEYWORDS.some(k => c.includes(k))).length;
      if (matches >= 2) { headerRowIndex = i; headerRow = rows[i]; break; }
    }
    const probeCount = detectProbeCount(headerRow, tab);
    const cols = detectColumns(headerRow, probeCount);
    const dataRows = rows.slice(headerRowIndex >= 0 ? headerRowIndex + 1 : 0);
    const entries = dataRows
      .map(row => parseRow(row, probeCount, cols))
      .filter(e => e.date !== '') // skip empty rows
      .slice(-limit); // take last N entries

    // Extract initial build dimensions from the sheet if width/length/height columns exist.
    // Some sheets have a metadata row (no date) with initial dimensions right after the header.
    let sheetDimensions: { heightCm: number | null; widthCm: number | null; lengthCm: number | null } | null = null;
    if (cols.heightCol !== null || cols.widthCol !== null || cols.lengthCol !== null) {
      const parseNum = (val: string | undefined): number | null => {
        if (!val || val === '') return null;
        const n = parseFloat(val);
        return isNaN(n) ? null : n;
      };
      // Check first few data rows for a dimensions-only row (no date but has dimension values)
      for (let i = 0; i < Math.min(5, dataRows.length); i++) {
        const row = dataRows[i];
        const date = (row[0] || '').trim();
        const h = cols.heightCol !== null ? parseNum(row[cols.heightCol]) : null;
        const w = cols.widthCol !== null ? parseNum(row[cols.widthCol]) : null;
        const l = cols.lengthCol !== null ? parseNum(row[cols.lengthCol]) : null;
        if ((h !== null || w !== null || l !== null) && date === '') {
          sheetDimensions = { heightCm: h, widthCm: w, lengthCm: l };
          break;
        }
      }
      // If no metadata row found, check the first data row with dimensions
      if (!sheetDimensions) {
        for (let i = 0; i < Math.min(10, dataRows.length); i++) {
          const row = dataRows[i];
          const h = cols.heightCol !== null ? parseNum(row[cols.heightCol]) : null;
          const w = cols.widthCol !== null ? parseNum(row[cols.widthCol]) : null;
          const l = cols.lengthCol !== null ? parseNum(row[cols.lengthCol]) : null;
          if (h !== null || w !== null || l !== null) {
            sheetDimensions = { heightCm: h, widthCm: w, lengthCm: l };
            break;
          }
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      entries,
      total: dataRows.length,
      ...(sheetDimensions ? { sheetDimensions } : {}),
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error reading history:', error);
    return new Response(JSON.stringify({
      error: 'Failed to read history',
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

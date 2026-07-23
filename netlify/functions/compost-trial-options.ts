import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

const METHOD_TAB = 'Trial Methods';
const METHOD_HEADER = 'Method';
const CROP_TAB = 'Trial Crops';
const CROP_HEADER = 'Crop';

// Seed values written on first creation of each tab. Must match
// src/utils/config.ts DEFAULT_TRIAL_METHODS / DEFAULT_TRIAL_CROPS at the
// moment the tab is seeded.
const SEED_METHODS = [
  'As mulch',
  'Top dress',
  'Trench at side',
  'Plant directly in',
];

const SEED_CROPS = [
  'Broad bean',
  'Pumpkin',
  'Currants',
  'Potatoes',
  'Gooseberries',
  'Tagasaste',
  'Comfrey',
];

function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

type Sheets = ReturnType<typeof getSheetsClient>;

async function ensureTabs(sheets: Sheets, spreadsheetId: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const titles = new Set(
    (meta.data.sheets || []).map(s => s.properties?.title || ''),
  );

  const missing: Array<{ tab: string; header: string; seed: string[] }> = [];
  if (!titles.has(METHOD_TAB)) missing.push({ tab: METHOD_TAB, header: METHOD_HEADER, seed: SEED_METHODS });
  if (!titles.has(CROP_TAB)) missing.push({ tab: CROP_TAB, header: CROP_HEADER, seed: SEED_CROPS });
  if (missing.length === 0) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: missing.map(m => ({ addSheet: { properties: { title: m.tab } } })),
    },
  });

  for (const m of missing) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${m.tab}'!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[m.header], ...m.seed.map(v => [v])] },
    });
  }
}

async function readColumn(sheets: Sheets, spreadsheetId: string, tab: string): Promise<string[]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab}'!A:A`,
  });
  const values = (res.data.values as string[][]) || [];
  return values
    .slice(1)
    .map(r => (r[0] || '').trim())
    .filter(Boolean);
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export default async (request: Request, _context: Context) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  try {
    const spreadsheetId = process.env.COMPOST_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return new Response(JSON.stringify({ error: 'Spreadsheet ID not configured' }), {
        status: 500,
        headers: JSON_HEADERS,
      });
    }

    const sheets = getSheetsClient();
    await ensureTabs(sheets, spreadsheetId);

    if (request.method === 'GET') {
      const [methods, crops] = await Promise.all([
        readColumn(sheets, spreadsheetId, METHOD_TAB),
        readColumn(sheets, spreadsheetId, CROP_TAB),
      ]);
      return new Response(JSON.stringify({ success: true, methods, crops }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const kind = (body.kind || '').toString().trim();
      const name = (body.name || '').toString().trim();
      if (kind !== 'method' && kind !== 'crop') {
        return new Response(JSON.stringify({ error: "kind must be 'method' or 'crop'" }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }
      if (!name) {
        return new Response(JSON.stringify({ error: 'Missing name' }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }

      const tab = kind === 'method' ? METHOD_TAB : CROP_TAB;
      const existing = await readColumn(sheets, spreadsheetId, tab);
      const duplicate = existing.some(v => v.toLowerCase() === name.toLowerCase());
      if (!duplicate) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'${tab}'!A:A`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [[name]] },
        });
      }
      const updated = duplicate ? existing : [...existing, name];
      const other = await readColumn(
        sheets,
        spreadsheetId,
        kind === 'method' ? CROP_TAB : METHOD_TAB,
      );

      return new Response(JSON.stringify({
        success: true,
        methods: kind === 'method' ? updated : other,
        crops: kind === 'crop' ? updated : other,
        added: !duplicate,
      }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  } catch (error) {
    console.error('Error in trial-options:', error);
    return new Response(JSON.stringify({
      error: 'Failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};

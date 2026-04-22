import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

const TAB = 'Build Types';
const HEADER = 'Build Type';

// Seed values written on first creation of the tab. Must match
// src/utils/config.ts DEFAULT_BUILD_TYPES at the moment the tab is seeded.
const SEED_TYPES = [
  'IBC Bioreactors (Johnson-Su Style) - Static',
  'IBC Bioreactors (Johnson-Su Style) - Non Static',
  'Circular Bioreactors (Central Airflow) – Static',
  'Compost Cylinders (Passive Systems) – Static',
  'Pallet Compost Bays (Turned Systems) – Non Static',
];

function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function ensureTab(
  sheets: ReturnType<typeof getSheetsClient>,
  spreadsheetId: string,
): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets?.find(s => s.properties?.title === TAB);
  if (existing) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
  });

  // Seed header + default types
  const seedRows = [[HEADER], ...SEED_TYPES.map(t => [t])];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${TAB}'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: seedRows },
  });
}

async function readTypes(
  sheets: ReturnType<typeof getSheetsClient>,
  spreadsheetId: string,
): Promise<string[]> {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TAB}'!A:A`,
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
    await ensureTab(sheets, spreadsheetId);

    if (request.method === 'GET') {
      const types = await readTypes(sheets, spreadsheetId);
      return new Response(JSON.stringify({ success: true, types }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const name = (body.name || '').toString().trim();
      if (!name) {
        return new Response(JSON.stringify({ error: 'Missing name' }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }

      const existing = await readTypes(sheets, spreadsheetId);
      const duplicate = existing.some(t => t.toLowerCase() === name.toLowerCase());
      if (!duplicate) {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'${TAB}'!A:A`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [[name]] },
        });
      }

      const types = duplicate ? existing : [...existing, name];
      return new Response(JSON.stringify({ success: true, types, added: !duplicate }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  } catch (error) {
    console.error('Error in build-types:', error);
    return new Response(JSON.stringify({
      error: 'Failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
};

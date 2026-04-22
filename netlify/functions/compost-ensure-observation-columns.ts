import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

// Adds 9 wildlife/plant-fungi observation columns to every compost system tab
// that doesn't already have them. Columns are appended AFTER the last
// populated column in the header row so existing layout stays intact.
//
// Safe to run multiple times — already-present columns are skipped.

const EXCLUDED_TABS = new Set([
  'bin tracker', 'system setup', 'score card', 'scorecard', 'template',
  'build info', 'build phases', 'sampling log', 'media',
]);

const OBSERVATION_HEADERS = [
  'Fruit Flies', 'Flies', 'Mites', 'Birds', 'Rats',
  'Ink Caps', 'Mushrooms', 'Fungus', 'Seedlings',
];

// Legacy → current header renames. Detected case-insensitively.
const HEADER_RENAMES: Array<[string, string]> = [
  ['inky caps', 'Ink Caps'],
];

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

function colLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
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

    const sheets = getGoogleSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const tabs = (meta.data.sheets || [])
      .map(s => s.properties?.title as string)
      .filter(Boolean)
      .filter(t => !EXCLUDED_TABS.has(t.toLowerCase().trim()));

    // Read the first row of each tab in one batch
    const ranges = tabs.map(t => `'${t}'!A1:AZ1`);
    const batch = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
    const headers = batch.data.valueRanges || [];

    const results: Array<{ tab: string; added: string[]; alreadyHad: string[]; renamed?: Array<{ from: string; to: string }> }> = [];

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const row = (headers[i]?.values?.[0] || []) as string[];
      const newHeaders: string[] = [...row];
      const renamed: Array<{ from: string; to: string }> = [];

      // 1. Apply legacy renames in-place
      for (let c = 0; c < newHeaders.length; c++) {
        const cellLower = (newHeaders[c] || '').toLowerCase().trim();
        for (const [from, to] of HEADER_RENAMES) {
          if (cellLower === from) {
            renamed.push({ from: newHeaders[c], to });
            newHeaders[c] = to;
            break;
          }
        }
      }

      // 2. Recompute lowercase after renames and find missing observation cols
      const lower = newHeaders.map(c => (c || '').toLowerCase().trim());
      const added: string[] = [];
      const alreadyHad: string[] = [];
      for (const h of OBSERVATION_HEADERS) {
        if (lower.includes(h.toLowerCase())) alreadyHad.push(h);
        else { newHeaders.push(h); added.push(h); }
      }

      if (added.length > 0 || renamed.length > 0) {
        const endCol = colLetter(newHeaders.length - 1);
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${tab}'!A1:${endCol}1`,
          valueInputOption: 'RAW',
          requestBody: { values: [newHeaders] },
        });
      }
      results.push({ tab, added, alreadyHad, renamed } as { tab: string; added: string[]; alreadyHad: string[]; renamed?: Array<{ from: string; to: string }> });
    }

    return new Response(JSON.stringify({ ok: true, tabsScanned: tabs.length, results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Ensure observation columns error:', err);
    return new Response(JSON.stringify({
      error: 'Failed to ensure observation columns',
      details: err instanceof Error ? err.message : String(err),
    }), { status: 500 });
  }
};

import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

const TAB = 'Build Phases';
const HEADERS = ['System', 'Phase', 'MaturationJSON', 'GrowJSON', 'UpdatedAt'];
const RANGE = `'${TAB}'!A:E`;

function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function ensureTab(sheets: ReturnType<typeof getSheetsClient>, spreadsheetId: string): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets?.find(s => s.properties?.title === TAB);
  if (existing) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${TAB}'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [HEADERS] },
  });
}

function parseJSON<T>(raw: string): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

interface PhaseRecord {
  system: string;
  phase: string;
  maturation: unknown;
  grow: unknown;
  updatedAt: string;
}

function parseRows(values: string[][]): PhaseRecord[] {
  if (!values || values.length < 2) return [];
  return values.slice(1).map(r => ({
    system: r[0] || '',
    phase: r[1] || 'thermophilic',
    maturation: parseJSON(r[2] || ''),
    grow: parseJSON(r[3] || ''),
    updatedAt: r[4] || '',
  })).filter(r => r.system);
}

/** Append a transition-note row to the build's own sheet. Best-effort — never throws. */
async function appendTransitionNote(
  sheets: ReturnType<typeof getSheetsClient>,
  spreadsheetId: string,
  sheetTab: string,
  note: string,
): Promise<void> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    // Columns A–W: Date, Time, Weather, AmbMin, AmbMax, Moisture, Odour, 9 probes, Avg, Peak, Vent, Visual, General, Media
    const row = [today, time, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', note, ''];
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${sheetTab}'!A:W`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
  } catch (err) {
    console.warn('Failed to append transition note to', sheetTab, err);
  }
}

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
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const sheets = getSheetsClient();
    await ensureTab(sheets, spreadsheetId);

    if (request.method === 'GET') {
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
      const rows = parseRows((res.data.values as string[][]) || []);
      return new Response(JSON.stringify({ success: true, phases: rows }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const system = body.system as string;
      const phase = (body.phase as string) || 'thermophilic';
      const sheetTab = (body.sheetTab as string) || '';
      // Merge-patch, NOT overwrite. A caller that only knows about one of these
      // (joining a trial run, editing a phase date) must not blank the other —
      // and a client whose local copy hasn't finished syncing must not be able
      // to wipe the richer record already in the sheet. `undefined` leaves the
      // stored value alone; an explicit `null` clears it.
      const maturationPatch = body.maturation;
      const growPatch = body.grow;
      const transitionNote = (body.transitionNote as string) || '';

      if (!system) {
        return new Response(JSON.stringify({ error: 'Missing system' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
      const values = (res.data.values as string[][]) || [];
      let foundIndex = -1;
      for (let i = 1; i < values.length; i++) {
        if (values[i][0] === system) { foundIndex = i; break; }
      }

      const existingRow = foundIndex >= 0 ? values[foundIndex] : [];
      const existingMaturation = parseJSON<unknown>(existingRow[2] || '');
      const existingGrow = parseJSON<unknown>(existingRow[3] || '');

      const maturation = maturationPatch === undefined ? existingMaturation : maturationPatch;
      const grow = growPatch === undefined ? existingGrow : growPatch;

      const updatedAt = new Date().toISOString();
      const row = [
        system,
        phase,
        maturation ? JSON.stringify(maturation) : '',
        grow ? JSON.stringify(grow) : '',
        updatedAt,
      ];

      if (foundIndex >= 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${TAB}'!A${foundIndex + 1}:E${foundIndex + 1}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [row] },
        });
      } else {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: RANGE,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [row] },
        });
      }

      if (sheetTab && transitionNote) {
        await appendTransitionNote(sheets, spreadsheetId, sheetTab, transitionNote);
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    console.error('Error in build-phase:', error);
    return new Response(JSON.stringify({
      error: 'Failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};

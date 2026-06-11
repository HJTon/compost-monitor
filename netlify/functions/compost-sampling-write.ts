import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const SPREADSHEET_ID = process.env.COMPOST_SPREADSHEET_ID || '1dY7TxghJegPDWUZF51QRmLhWUXVFBcdK5BYzOLsbNAo';
const TAB_NAME = 'Sampling Log';

interface SampleRow {
  date: string;         // DD/MM/YYYY
  sampleId: string;     // e.g. S7
  system: string;       // e.g. Pivot #1
  turn: string;         // turn number or blank
  height: string;       // cm or blank
  probe: string;        // probe number or layer name
  subSample: string;    // a, b, c, d or blank
  temperature: string;  // °F or blank
  depth: string;        // cm or blank
  method: string;       // Auger / Layered / New tool / Dug
  handling: string;     // storage + transport
  notes: string;        // free text
}

export default async (req: Request, _context: Context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
  }

  try {
    const body = await req.json();
    const rows: SampleRow[] = body.rows;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return new Response(JSON.stringify({ error: 'rows array required' }), { status: 400 });
    }

    const sheets = getGoogleSheetsClient();

    const values = rows.map(r => [
      r.date, r.sampleId, r.system, r.turn, r.height,
      r.probe, r.subSample, r.temperature, r.depth,
      r.method, r.handling, r.notes,
    ]);

    // Dedupe against rows already in the sheet so the offline sync queue can
    // safely retry this request (e.g. when the response was lost on a flaky
    // connection after the append actually succeeded). Identity = date +
    // sample id + system + probe + sub-sample + temperature (turn/height
    // excluded — they can vary in formatting between client and sheet).
    // Temperature is included so a deliberately re-logged correction with a
    // different value still gets written.
    const keyOf = (cells: unknown[]) =>
      JSON.stringify(cells.slice(0, 8).map((c, i) => (i === 3 || i === 4) ? '' : String(c ?? '').trim().toLowerCase()));
    let existingKeys = new Set<string>();
    try {
      const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${TAB_NAME}'!A:H`,
      });
      existingKeys = new Set((existing.data.values || []).map(r => keyOf(r)));
    } catch {
      // Tab unreadable (e.g. doesn't exist yet) — fall through, append handles creation errors
    }

    const newValues = values.filter(v => !existingKeys.has(keyOf(v)));
    const skipped = values.length - newValues.length;

    if (newValues.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${TAB_NAME}'!A:L`,
        valueInputOption: 'RAW',
        requestBody: { values: newValues },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      rowsWritten: newValues.length,
      duplicatesSkipped: skipped,
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

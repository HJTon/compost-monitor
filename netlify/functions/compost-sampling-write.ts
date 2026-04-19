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

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${TAB_NAME}'!A:L`,
      valueInputOption: 'RAW',
      requestBody: { values },
    });

    return new Response(JSON.stringify({
      success: true,
      rowsWritten: values.length,
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

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

const SPREADSHEET_ID = process.env.COMPOST_SPREADSHEET_ID || '1dY7TxghJegPDWUZF51QRmLhWUXVFBcdK5BYzOLsbNAo';
const TAB_NAME = 'Sampling Log';

export default async (req: Request, _context: Context) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'GET only' }), { status: 405 });
  }

  try {
    const sheets = getGoogleSheetsClient();

    // Read just the Sample ID column (B)
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${TAB_NAME}'!B:B`,
    });

    const values = res.data.values || [];
    let maxNum = 0;

    for (const row of values) {
      const val = (row[0] || '').toString().trim();
      const match = val.match(/^S\s*(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }

    return new Response(JSON.stringify({
      nextId: `S${maxNum + 1}`,
      currentMax: maxNum,
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

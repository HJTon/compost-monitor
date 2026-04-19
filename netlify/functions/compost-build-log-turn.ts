import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

// Logs a turn for a build. Finds the most recent row for the given date (or
// today if not specified) and writes "Turn" in the Turn column.  If no Turn
// column exists yet (older builds), it adds one.

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

function formatNZDate(): string {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date());
  const day = parts.find(p => p.type === 'day')?.value ?? '';
  const month = parts.find(p => p.type === 'month')?.value ?? '';
  const year = parts.find(p => p.type === 'year')?.value ?? '';
  return `${day}/${month}/${year}`;
}

// Column index to letter
function colLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

export default async (request: Request, _context: Context) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
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

    const { buildName, date } = await request.json() as {
      buildName?: string;
      date?: string; // DD/MM/YYYY — optional, defaults to today NZ
    };
    if (!buildName?.trim()) {
      return new Response(JSON.stringify({ error: 'buildName is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sheets = getGoogleSheetsClient();
    const tabName = buildName.trim();
    const targetDate = date || formatNZDate();

    // Read the full sheet to find headers + the target row
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: tabName,
    });
    const rows = response.data.values || [];

    // Find header row (look in first 5 rows for one with 'Date' and 'Average')
    const HEADER_KEYWORDS = ['date', 'time', 'weather', 'averag', 'peak'];
    let headerRowIdx = -1;
    let headerRow: string[] = [];
    for (let i = 0; i < Math.min(5, rows.length); i++) {
      const lower = (rows[i] || []).map((c: string) => c.toLowerCase().trim());
      const matches = lower.filter(c => HEADER_KEYWORDS.some(k => c.includes(k))).length;
      if (matches >= 2) { headerRowIdx = i; headerRow = rows[i]; break; }
    }
    if (headerRowIdx < 0) {
      return new Response(JSON.stringify({ error: 'Could not find header row' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Find or create Turn/Turns column
    const lowerHeaders = headerRow.map(h => h.toLowerCase().trim());
    let turnColIdx = lowerHeaders.findIndex(h => h === 'turn' || h === 'turns');

    if (turnColIdx < 0) {
      // Add Turn header at end of header row
      turnColIdx = headerRow.length;
      const headerSheetRow = headerRowIdx + 1; // 1-based
      const turnColLetter = colLetter(turnColIdx);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tabName}'!${turnColLetter}${headerSheetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Turn']] },
      });
    }

    // Find the most recent row matching targetDate
    // Date is in column A, compare as-is (DD/MM/YYYY)
    let targetRowIdx = -1;
    for (let i = rows.length - 1; i > headerRowIdx; i--) {
      const cellDate = (rows[i]?.[0] || '').trim();
      if (cellDate === targetDate) {
        targetRowIdx = i;
        break;
      }
    }

    if (targetRowIdx < 0) {
      // No data row for this date — append a new row with just date + Turn
      const newRow: string[] = new Array(turnColIdx + 1).fill('');
      newRow[0] = targetDate;
      newRow[turnColIdx] = 'Turn';

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${tabName}'!A:A`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [newRow] },
      });
    } else {
      // Write "Turn" into the Turn column of the found row
      const sheetRow = targetRowIdx + 1;
      const turnColLetter = colLetter(turnColIdx);
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tabName}'!${turnColLetter}${sheetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Turn']] },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      buildName: tabName,
      date: targetDate,
      turnColAdded: turnColIdx === headerRow.length,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (error) {
    console.error('Error logging turn:', error);
    return new Response(JSON.stringify({
      error: 'Failed to log turn',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};

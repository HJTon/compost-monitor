import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

// Removes one or more bins from an existing build without touching the build
// itself. Clears cols H + I on the matching Bin Tracker rows and resets the
// colour strip on cols E + I back to white.
//
// The matching is done by (buildName, binSerial) pairs rather than by row
// index, so a concurrent Bin Tracker edit between the client fetch and this
// call can't cause us to blank the wrong row.

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
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

    const { buildName, binSerials } = await request.json() as {
      buildName?: string;
      binSerials?: string[];
    };
    if (!buildName?.trim()) {
      return new Response(JSON.stringify({ error: 'buildName is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!Array.isArray(binSerials) || binSerials.length === 0) {
      return new Response(JSON.stringify({ error: 'binSerials array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sheets = getGoogleSheetsClient();
    const tabName = buildName.trim();
    const serialSet = new Set(binSerials.map(s => s.trim()).filter(Boolean));

    // Fetch cols E (serial) and I (batch) so we can locate the exact rows
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Bin Tracker'!A:I",
    });
    const rows = res.data.values ?? [];

    // 0-based row indices (row 0 = header); skip header
    const affectedIndices: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const serial = (row[4] || '').toString().trim();
      const batch = (row[8] || '').toString().trim();
      if (batch === tabName && serialSet.has(serial)) {
        affectedIndices.push(i);
      }
    }

    if (affectedIndices.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        buildName: tabName,
        binsCleared: 0,
        note: 'No matching bins found for this build',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // Clear col H (batching date) and col I (batch name)
    const clearData = affectedIndices.map(rowIndex => {
      const sheetRow = rowIndex + 1;
      return { range: `'Bin Tracker'!H${sheetRow}:I${sheetRow}`, values: [['', '']] };
    });
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: { valueInputOption: 'USER_ENTERED', data: clearData },
    });

    // Reset background colour on cols E and I back to white
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const binTrackerSheetId = spreadsheet.data.sheets?.find(
      (s: any) => s.properties?.title === 'Bin Tracker',
    )?.properties?.sheetId ?? null;

    if (binTrackerSheetId != null) {
      const white = { red: 1, green: 1, blue: 1 };
      const resetRequests = affectedIndices.flatMap(rowIndex => [
        {
          repeatCell: {
            range: {
              sheetId: binTrackerSheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: 4, // col E — bin serial number
              endColumnIndex: 5,
            },
            cell: { userEnteredFormat: { backgroundColor: white } },
            fields: 'userEnteredFormat(backgroundColor)',
          },
        },
        {
          repeatCell: {
            range: {
              sheetId: binTrackerSheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: 8, // col I — batch name
              endColumnIndex: 9,
            },
            cell: { userEnteredFormat: { backgroundColor: white } },
            fields: 'userEnteredFormat(backgroundColor)',
          },
        },
      ]);

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: resetRequests },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      buildName: tabName,
      binsCleared: affectedIndices.length,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (error) {
    console.error('Error removing bins from build:', error);
    return new Response(JSON.stringify({
      error: 'Failed to remove bins',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};

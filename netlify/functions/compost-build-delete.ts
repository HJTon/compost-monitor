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

    const { buildName } = await request.json();
    if (!buildName?.trim()) {
      return new Response(JSON.stringify({ error: 'buildName is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sheets = getGoogleSheetsClient();
    const tabName = buildName.trim();

    // Get spreadsheet metadata (sheet IDs)
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });

    const binTrackerSheetId = spreadsheet.data.sheets?.find(
      (s: any) => s.properties?.title === 'Bin Tracker',
    )?.properties?.sheetId ?? null;

    const buildSheetId = spreadsheet.data.sheets?.find(
      (s: any) => s.properties?.title === tabName,
    )?.properties?.sheetId ?? null;

    // Find Bin Tracker rows where col I = tabName
    const colIResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Bin Tracker'!I:I",
    });
    const colIValues = colIResponse.data.values ?? [];

    // 0-based row indices (row 0 = header); skip header
    const affectedIndices: number[] = [];
    for (let i = 1; i < colIValues.length; i++) {
      if (colIValues[i]?.[0] === tabName) {
        affectedIndices.push(i);
      }
    }

    if (affectedIndices.length > 0) {
      // Clear col H (batching date) and col I (batch name)
      const clearData = affectedIndices.map(rowIndex => {
        const sheetRow = rowIndex + 1;
        return { range: `'Bin Tracker'!H${sheetRow}:I${sheetRow}`, values: [['', '']] };
      });

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: clearData },
      });

      // Reset background colour on col E and col I back to white
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
    }

    // Delete the build's sheet tab if it exists
    let tabDeleted = false;
    if (buildSheetId != null) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ deleteSheet: { sheetId: buildSheetId } }] },
      });
      tabDeleted = true;
    }

    return new Response(JSON.stringify({
      success: true,
      buildName: tabName,
      tabDeleted,
      binsCleared: affectedIndices.length,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (error) {
    console.error('Error deleting build:', error);
    return new Response(JSON.stringify({
      error: 'Failed to delete build',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};

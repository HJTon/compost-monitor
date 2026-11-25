import { sharedSheetId, farmSheetId, binFarmColumn, binIsAtFarm } from './_lib/farms';
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
    // Bin Tracker is in the shared sheet; the build's own tab is in the farm's sheet.
    const spreadsheetId = sharedSheetId();
    const farmSpreadsheetId = farmSheetId(request);

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
    const farmSpreadsheet = farmSpreadsheetId === spreadsheetId
      ? spreadsheet
      : await sheets.spreadsheets.get({ spreadsheetId: farmSpreadsheetId });

    const binTrackerSheetId = spreadsheet.data.sheets?.find(
      (s: any) => s.properties?.title === 'Bin Tracker',
    )?.properties?.sheetId ?? null;

    const buildSheetId = farmSpreadsheet.data.sheets?.find(
      (s: any) => s.properties?.title === tabName,
    )?.properties?.sheetId ?? null;

    // Find this farm's Bin Tracker rows where col K = tabName
    const trackerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Bin Tracker'!A:O",
    });
    const trackerRows = trackerResponse.data.values ?? [];
    const farmCol = binFarmColumn(trackerRows[0]);

    // 0-based row indices (row 0 = header); skip header
    const affectedIndices: number[] = [];
    for (let i = 1; i < trackerRows.length; i++) {
      if (trackerRows[i]?.[10] === tabName && binIsAtFarm(trackerRows[i], request, farmCol)) {
        affectedIndices.push(i);
      }
    }

    if (affectedIndices.length > 0) {
      // Clear col J (batching date) and col K (batch name)
      const clearData = affectedIndices.map(rowIndex => {
        const sheetRow = rowIndex + 1;
        return { range: `'Bin Tracker'!J${sheetRow}:K${sheetRow}`, values: [['', '']] };
      });

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: clearData },
      });

      // Reset background colour on col G and col K back to white
      if (binTrackerSheetId != null) {
        const white = { red: 1, green: 1, blue: 1 };
        const resetRequests = affectedIndices.flatMap(rowIndex => [
          {
            repeatCell: {
              range: {
                sheetId: binTrackerSheetId,
                startRowIndex: rowIndex,
                endRowIndex: rowIndex + 1,
                startColumnIndex: 6, // col G — bin serial number
                endColumnIndex: 7,
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
                startColumnIndex: 10, // col K — batch name
                endColumnIndex: 11,
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
        spreadsheetId: farmSpreadsheetId,
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

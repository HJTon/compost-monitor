import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

// Repaints every bin belonging to a given build, plus the header row on the
// build's own sheet tab, to a new colour. Pass `colour: null` (or omit it) to
// reset everything back to white.
//
// Bin rows are matched by col I === buildName, so concurrent edits to Bin
// Tracker between any earlier client fetch and this call are still safe.

const COLOUR_RGB: Record<string, { red: number; green: number; blue: number }> = {
  red:    { red: 0.92, green: 0.55, blue: 0.55 },
  orange: { red: 1.00, green: 0.73, blue: 0.40 },
  yellow: { red: 1.00, green: 0.95, blue: 0.40 },
  green:  { red: 0.42, green: 0.73, blue: 0.42 },
  teal:   { red: 0.30, green: 0.73, blue: 0.73 },
  blue:   { red: 0.45, green: 0.60, blue: 0.93 },
  purple: { red: 0.70, green: 0.45, blue: 0.90 },
  pink:   { red: 1.00, green: 0.60, blue: 0.75 },
};

const WHITE = { red: 1, green: 1, blue: 1 };

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

    const { buildName, colour } = await request.json() as {
      buildName?: string;
      colour?: string | null;
    };
    if (!buildName?.trim()) {
      return new Response(JSON.stringify({ error: 'buildName is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const normalised = (colour || '').toLowerCase().trim();
    const rgb = normalised ? COLOUR_RGB[normalised] : null;
    if (normalised && !rgb) {
      return new Response(JSON.stringify({ error: `Unknown colour "${colour}"` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const targetColour = rgb ?? WHITE;

    const sheets = getGoogleSheetsClient();
    const tabName = buildName.trim();

    // Get sheet metadata for both Bin Tracker and the build tab
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const binTrackerSheetId = spreadsheet.data.sheets?.find(
      (s: any) => s.properties?.title === 'Bin Tracker',
    )?.properties?.sheetId ?? null;
    const buildSheetId = spreadsheet.data.sheets?.find(
      (s: any) => s.properties?.title === tabName,
    )?.properties?.sheetId ?? null;

    // Find Bin Tracker rows where col K === buildName
    const colIResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Bin Tracker'!K:K",
    });
    const colIValues = colIResponse.data.values ?? [];
    const affectedIndices: number[] = [];
    for (let i = 1; i < colIValues.length; i++) {
      if ((colIValues[i]?.[0] ?? '').toString().trim() === tabName) {
        affectedIndices.push(i);
      }
    }

    const requests: any[] = [];

    // Recolour cols G + K on each matching Bin Tracker row
    if (binTrackerSheetId != null) {
      for (const rowIndex of affectedIndices) {
        requests.push({
          repeatCell: {
            range: {
              sheetId: binTrackerSheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: 6, // col G — bin serial number
              endColumnIndex: 7,
            },
            cell: { userEnteredFormat: { backgroundColor: targetColour } },
            fields: 'userEnteredFormat(backgroundColor)',
          },
        });
        requests.push({
          repeatCell: {
            range: {
              sheetId: binTrackerSheetId,
              startRowIndex: rowIndex,
              endRowIndex: rowIndex + 1,
              startColumnIndex: 10, // col K — batch name
              endColumnIndex: 11,
            },
            cell: { userEnteredFormat: { backgroundColor: targetColour } },
            fields: 'userEnteredFormat(backgroundColor)',
          },
        });
      }
    }

    // Recolour the build tab's header row (row 1, cols A–Z)
    if (buildSheetId != null) {
      requests.push({
        repeatCell: {
          range: {
            sheetId: buildSheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: 26,
          },
          cell: { userEnteredFormat: { backgroundColor: targetColour } },
          fields: 'userEnteredFormat(backgroundColor)',
        },
      });
    }

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
      });
    }

    // Also update col H (colour label) on Bin Tracker so Bin Lookup matches
    if (affectedIndices.length > 0) {
      const label = normalised;
      const labelUpdates = affectedIndices.map(rowIndex => {
        const sheetRow = rowIndex + 1;
        return { range: `'Bin Tracker'!H${sheetRow}`, values: [[label]] };
      });
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data: labelUpdates },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      buildName: tabName,
      colour: normalised || null,
      binsRecoloured: affectedIndices.length,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (error) {
    console.error('Error recolouring build:', error);
    return new Response(JSON.stringify({
      error: 'Failed to recolour build',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};

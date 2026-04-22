import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

// Maps colour names to pastel-ish RGB for Google Sheets background
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

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Format a date as DD-MMM-YYYY to match the Bin Tracker format.
// Accepts an optional YYYY-MM-DD string; defaults to today in NZ time.
function formatNZDate(dateStr?: string): string {
  // Parse as noon NZ time to avoid day-boundary issues with UTC offsets
  const d = dateStr
    ? new Date(`${dateStr}T12:00:00+12:00`)
    : new Date();
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).formatToParts(d);
  const day = parts.find(p => p.type === 'day')?.value ?? '';
  const month = parts.find(p => p.type === 'month')?.value ?? '';
  const year = parts.find(p => p.type === 'year')?.value ?? '';
  return `${day}-${month}-${year}`; // e.g. "21-Feb-2026"
}

interface CreateBuildRequest {
  buildName: string;       // e.g. "Pivot #5" — also used as the sheet tab name
  probeCount: number;      // 3, 5, or 9
  binRowIndices: number[]; // 0-based array indices from the fetched Bin Tracker data
                           // (index 0 = header row = sheet row 1, index 1 = first data row = sheet row 2)
  height?: number;         // Optional initial pile height in cm
  buildDate?: string;      // YYYY-MM-DD — defaults to today in NZ time
  colour?: string;         // Optional colour label written to col F of selected bins
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

    const body: CreateBuildRequest = await request.json();
    const { buildName, probeCount, binRowIndices, height, buildDate, colour } = body;

    if (!buildName?.trim()) {
      return new Response(JSON.stringify({ error: 'buildName is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!probeCount || ![3, 5, 9].includes(probeCount)) {
      return new Response(JSON.stringify({ error: 'probeCount must be 3, 5, or 9' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!binRowIndices?.length) {
      return new Response(JSON.stringify({ error: 'At least one bin must be selected' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sheets = getGoogleSheetsClient();
    const tabName = buildName.trim();

    // ── 1. Create the new monitoring sheet tab ──────────────────────────────
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const tabExists = spreadsheet.data.sheets?.some(
      (s: any) => s.properties?.title === tabName,
    );

    let newSheetId: number | null = null;
    if (!tabExists) {
      // Create the tab and capture the new sheet's ID for formatting
      const addSheetResponse = await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tabName } } }],
        },
      });
      newSheetId = addSheetResponse.data.replies?.[0]?.addSheet?.properties?.sheetId ?? null;

      // Rows 1–3: title area (build name top-right in column P, height note below if provided)
      // Row 4:    column headers — data starts at row 5
      // Height is last column so the daily-entry write function's row layout stays aligned
      const probeHeaders = Array.from({ length: probeCount }, (_, i) => `Probe ${i + 1}`);
      const headers = [
        'Date', 'Time', 'Weather', 'Amb Min', 'Amb Max', 'Moisture', 'Odour',
        ...probeHeaders,
        'Average', 'Peak',
        'Vent Temps', 'Visual Notes', 'General Notes', 'Media Links',
        'Height', 'Turn', 'Sample',
      ];

      const titleValues = [
        [tabName],                                                    // P1: build name
        height != null ? [`Initial height: ${height} cm`] : [''],   // P2: optional height note
      ];

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: [
            { range: `'${tabName}'!A1:A2`, values: titleValues },
            { range: `'${tabName}'!A4`, values: [headers] },
          ],
        },
      });

      // Format row 1: bold 18pt title in A1, optional background colour across the whole row
      if (newSheetId != null) {
        const formatRequests: any[] = [
          {
            repeatCell: {
              range: {
                sheetId: newSheetId,
                startRowIndex: 0,
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  textFormat: { bold: true, fontSize: 18 },
                  horizontalAlignment: 'LEFT',
                  verticalAlignment: 'MIDDLE',
                },
              },
              fields: 'userEnteredFormat(textFormat,horizontalAlignment,verticalAlignment)',
            },
          },
        ];

        const rgb = colour ? COLOUR_RGB[colour] : null;
        if (rgb) {
          formatRequests.push({
            repeatCell: {
              range: {
                sheetId: newSheetId,
                startRowIndex: 0,  // entire row 1
                endRowIndex: 1,
                startColumnIndex: 0,
                endColumnIndex: 26,
              },
              cell: {
                userEnteredFormat: { backgroundColor: rgb },
              },
              fields: 'userEnteredFormat(backgroundColor)',
            },
          });
        }

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: formatRequests },
        });
      }
    }

    // ── 2. Update selected Bin Tracker rows ─────────────────────────────────
    // Set col J = Date of Batching, col K = Batch (build name)
    const today = formatNZDate(buildDate);
    const batchUpdates = binRowIndices.map(arrayIndex => {
      const sheetRow = arrayIndex + 1;
      return { range: `'Bin Tracker'!J${sheetRow}:K${sheetRow}`, values: [[today, tabName]] };
    });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: batchUpdates,
      },
    });

    // Apply background colour to col G (bin serial) and col K (batch name) in Bin Tracker
    if (colour) {
      const rgb = COLOUR_RGB[colour];
      const binTrackerSheetId = spreadsheet.data.sheets?.find(
        (s: any) => s.properties?.title === 'Bin Tracker',
      )?.properties?.sheetId ?? null;

      if (rgb && binTrackerSheetId != null) {
        const colourRequests = binRowIndices.flatMap(arrayIndex => [
          {
            repeatCell: {
              range: {
                sheetId: binTrackerSheetId,
                startRowIndex: arrayIndex,
                endRowIndex: arrayIndex + 1,
                startColumnIndex: 6, // col G — bin serial number
                endColumnIndex: 7,
              },
              cell: { userEnteredFormat: { backgroundColor: rgb } },
              fields: 'userEnteredFormat(backgroundColor)',
            },
          },
          {
            repeatCell: {
              range: {
                sheetId: binTrackerSheetId,
                startRowIndex: arrayIndex,
                endRowIndex: arrayIndex + 1,
                startColumnIndex: 10, // col K — batch name
                endColumnIndex: 11,
              },
              cell: { userEnteredFormat: { backgroundColor: rgb } },
              fields: 'userEnteredFormat(backgroundColor)',
            },
          },
        ]);

        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: colourRequests },
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      buildName: tabName,
      tabCreated: !tabExists,
      binsAssigned: binRowIndices.length,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Error creating build:', error);
    return new Response(JSON.stringify({
      error: 'Failed to create build',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
};

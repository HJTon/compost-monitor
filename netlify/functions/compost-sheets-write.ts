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

// Map system IDs to their sheet tab names
const SYSTEM_TAB_MAP: Record<string, string> = {
  'pivot-1': 'Pivot #1',
  'pivot-2': 'Pivot #2',
  'pivot-3': 'Pivot #3',
  'pivot-4': 'Pivot #4',
  'cylinder-1': 'Cylinder #1',
  'batch-1': 'Batch 1',
  'batch-2': 'Batch 2',
  'batch-3': 'Batch 3',
};

interface WriteRequest {
  tab: string;
  date: string;
  time: string;
  weather: string | null;
  ambientMin: number | null;
  ambientMax: number | null;
  moisture: string | null;
  odour: string | null;
  probes: (number | null)[];
  ventTemps: string;
  visualNotes: string;
  generalNotes: string;
  mediaIds: string[];
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

    const body: WriteRequest = await request.json();
    const sheetTab = SYSTEM_TAB_MAP[body.tab] || body.tab;

    // Build row: Date, Time, Weather, Ambient Min, Ambient Max, Moisture, Odour,
    //            Probe1-9, Average (formula), Peak (formula),
    //            Vent Temps, Visual Notes, General Notes, Media Links
    const probeValues = body.probes.map(v => v !== null ? v : '');

    // Row will be appended - we'll add formulas for calculated columns
    const row = [
      body.date,
      body.time,
      body.weather || '',
      body.ambientMin !== null ? body.ambientMin : '',
      body.ambientMax !== null ? body.ambientMax : '',
      body.moisture || '',
      body.odour || '',
      ...probeValues,
      // Average and Peak will be formulas - placeholder for now
      '', '',
      body.ventTemps || '',
      body.visualNotes || '',
      body.generalNotes || '',
      body.mediaIds.join(', '),
    ];

    const sheets = getGoogleSheetsClient();

    // Append the row
    const appendResult = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${sheetTab}'!A:A`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [row],
      },
    });

    // Get the row number that was written to, then update formulas
    const updatedRange = appendResult.data.updates?.updatedRange;
    if (updatedRange) {
      // Extract row number from range like "'Pivot #1'!A5:T5"
      const match = updatedRange.match(/!.*?(\d+)/);
      if (match) {
        const rowNum = match[1];
        // Column I is probe 1 (index 8), Column Q is probe 9 (index 16)
        // Average goes in column R (index 17), Peak in column S (index 18)
        const avgFormula = `=IF(COUNTA(I${rowNum}:Q${rowNum})>0,AVERAGE(I${rowNum}:Q${rowNum}),"")`;
        const peakFormula = `=IF(COUNTA(I${rowNum}:Q${rowNum})>0,MAX(I${rowNum}:Q${rowNum}),"")`;

        // Probe columns H through P (columns 8-16 = I-Q in 1-indexed)
        // So average = column R, peak = column S
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${sheetTab}'!R${rowNum}:S${rowNum}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[avgFormula, peakFormula]],
          },
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Row appended to ${sheetTab}`,
      updatedRange,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error writing to sheet:', error);
    return new Response(JSON.stringify({
      error: 'Failed to write to sheet',
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

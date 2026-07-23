import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

const BUILD_INFO_TAB = 'Build Info';

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// Format a YYYY-MM-DD date as DD-MMM-YYYY to match the Bin Tracker format.
// Parsed as noon NZ time to avoid day-boundary issues with UTC offsets.
function formatNZDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00+12:00`);
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

    const { buildName, buildDate } = await request.json();
    if (!buildName?.trim()) {
      return new Response(JSON.stringify({ error: 'buildName is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(buildDate || '').trim())) {
      return new Response(JSON.stringify({ error: 'buildDate must be YYYY-MM-DD' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sheets = getGoogleSheetsClient();
    const tabName = buildName.trim();
    const isoDate = String(buildDate).trim();
    const trackerDate = formatNZDate(isoDate);

    // ── 1. Find Bin Tracker rows where col K = build name ───────────────────
    const colKResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "'Bin Tracker'!K:K",
    });
    const colKValues = colKResponse.data.values ?? [];

    // 0-based row indices (row 0 = header); skip header
    const affectedIndices: number[] = [];
    for (let i = 1; i < colKValues.length; i++) {
      if (colKValues[i]?.[0] === tabName) {
        affectedIndices.push(i);
      }
    }

    // ── 2. Write the new date into col J of each matched row ────────────────
    if (affectedIndices.length > 0) {
      const data = affectedIndices.map(rowIndex => {
        const sheetRow = rowIndex + 1;
        return { range: `'Bin Tracker'!J${sheetRow}`, values: [[trackerDate]] };
      });

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: { valueInputOption: 'USER_ENTERED', data },
      });
    }

    // ── 3. Upsert BuildDate (col J) in the Build Info tab ───────────────────
    // Best-effort: the Bin Tracker write above is the important one, and the
    // client also POSTs to compost-build-info, so a missing tab here must not
    // fail the request.
    let buildInfoUpdated = false;
    try {
      const infoResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${BUILD_INFO_TAB}'!A:J`,
      });
      const infoValues = (infoResponse.data.values as string[][]) ?? [];
      let infoRowIndex = -1;
      for (let i = 1; i < infoValues.length; i++) {
        if (infoValues[i]?.[0] === tabName) { infoRowIndex = i; break; }
      }

      if (infoRowIndex >= 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${BUILD_INFO_TAB}'!I${infoRowIndex + 1}:J${infoRowIndex + 1}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[new Date().toISOString(), isoDate]] },
        });
        buildInfoUpdated = true;
      } else if (infoValues.length > 0) {
        // Tab exists (with headers) but this build has no row yet — append one.
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: `'${BUILD_INFO_TAB}'!A:J`,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: {
            values: [[tabName, '', '', '', '', '', '', '', new Date().toISOString(), isoDate]],
          },
        });
        buildInfoUpdated = true;
      }
    } catch (infoErr) {
      console.warn('Build Info buildDate upsert skipped:', infoErr);
    }

    return new Response(JSON.stringify({
      success: true,
      buildName: tabName,
      buildDate: isoDate,
      binsUpdated: affectedIndices.length,
      buildInfoUpdated,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (error) {
    console.error('Error setting build date:', error);
    return new Response(JSON.stringify({
      error: 'Failed to set build date',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};

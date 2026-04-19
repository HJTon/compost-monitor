import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

// Ensures every build tab has the standard extra columns: Height, Turn, Sample.
// Finds each tab's header row and appends any missing columns at the end.
// Safe to call repeatedly — skips columns that already exist.
// Checks for variations like "Height in cm" matching "height".

const EXCLUDED_TABS = new Set([
  'bin tracker',
  'system setup',
  'score card',
  'scorecard',
  'template',
]);

// Columns we want on every build tab. Each entry has the label to write
// and a matcher that checks whether the column already exists.
const REQUIRED_COLUMNS: { label: string; match: (h: string) => boolean }[] = [
  { label: 'Height', match: h => h.includes('height') },
  { label: 'Turn',   match: h => h === 'turn' || h === 'turns' },
  { label: 'Sample', match: h => h.includes('sample') },
];

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

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

  try {
    const spreadsheetId = process.env.COMPOST_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return new Response(JSON.stringify({ error: 'Spreadsheet ID not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sheets = getGoogleSheetsClient();

    // Get all tabs
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const allTabs = (spreadsheet.data.sheets || [])
      .map((s: any) => s.properties?.title as string)
      .filter(Boolean);

    const candidateTabs = allTabs.filter(
      t => !EXCLUDED_TABS.has(t.toLowerCase().trim())
    );

    // Read first 5 rows of each tab to find headers
    const ranges = candidateTabs.map(t => `'${t}'!A1:AZ5`);
    let batchData: any[] = [];
    if (ranges.length > 0) {
      const batchResponse = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
      });
      batchData = batchResponse.data.valueRanges || [];
    }

    const HEADER_KEYWORDS = ['date', 'time', 'weather', 'probe', 'temp', 'average', 'peak', 'moisture', 'odour', 'ambient'];
    const batchUpdateData: { range: string; values: string[][] }[] = [];
    const report: { tab: string; added: string[] }[] = [];

    for (let i = 0; i < candidateTabs.length; i++) {
      const tabName = candidateTabs[i];
      const rows = batchData[i]?.values || [];

      // Find header row
      let headerRow: string[] | null = null;
      let headerRowIdx = -1;
      for (let r = 0; r < rows.length; r++) {
        const row = (rows[r] || []) as string[];
        const lower = row.map((c: string) => (c || '').toLowerCase().trim());
        const matches = lower.filter(c => HEADER_KEYWORDS.some(k => c.includes(k))).length;
        if (matches >= 3) {
          headerRow = row;
          headerRowIdx = r;
          break;
        }
      }

      if (!headerRow) continue;

      const lowerHeaders = headerRow.map(h => (h || '').toLowerCase().trim());
      let nextCol = headerRow.length;
      const added: string[] = [];

      for (const col of REQUIRED_COLUMNS) {
        // Check if any existing header matches
        if (lowerHeaders.some(h => col.match(h))) continue;

        // Add this column at the next available position
        batchUpdateData.push({
          range: `'${tabName}'!${colLetter(nextCol)}${headerRowIdx + 1}`,
          values: [[col.label]],
        });
        added.push(col.label);
        nextCol++;
      }

      if (added.length > 0) {
        report.push({ tab: tabName, added });
      }
    }

    if (batchUpdateData.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'All tabs already have Height, Turn, and Sample columns',
        tabsUpdated: 0,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: batchUpdateData,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      tabsUpdated: report.length,
      columnsAdded: batchUpdateData.length,
      details: report,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (error) {
    console.error('Error ensuring standard columns:', error);
    return new Response(JSON.stringify({
      error: 'Failed to ensure standard columns',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};

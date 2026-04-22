import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

// Discovers all build/system tabs in the spreadsheet by checking which tabs
// have a header row containing temperature-related columns. Returns a list
// of systems with their tab name and detected probe count.
//
// Tabs that are clearly not build sheets (Bin Tracker, System Setup, Score
// card, etc.) are excluded.

const EXCLUDED_TABS = new Set([
  'bin tracker',
  'system setup',
  'score card',
  'scorecard',
  'template',
  'build info',
  'build phases',
  'sampling log',
  'media',
]);

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

interface DiscoveredSystem {
  tabName: string;
  probeCount: number;
  hasData: boolean; // true if there are data rows beyond the header
}

export default async (request: Request, _context: Context) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
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

    // Get all tab names
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const allTabs = (spreadsheet.data.sheets || [])
      .map((s: any) => s.properties?.title as string)
      .filter(Boolean);

    // Filter out known non-build tabs
    const candidateTabs = allTabs.filter(
      t => !EXCLUDED_TABS.has(t.toLowerCase().trim())
    );

    // For each candidate, read the first 5 rows to check for a header row
    // Use batchGet to read all tabs in one API call
    const ranges = candidateTabs.map(t => `'${t}'!A1:AZ5`);

    let batchData: any[] = [];
    if (ranges.length > 0) {
      const batchResponse = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
      });
      batchData = batchResponse.data.valueRanges || [];
    }

    // Also get row counts for each tab to know if they have data
    // Read column A to check for data rows
    const dataRanges = candidateTabs.map(t => `'${t}'!A1:A100`);
    let dataCountData: any[] = [];
    if (dataRanges.length > 0) {
      const dataCountResponse = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges: dataRanges,
      });
      dataCountData = dataCountResponse.data.valueRanges || [];
    }

    const HEADER_KEYWORDS = ['date', 'time', 'weather', 'probe', 'temp', 'average', 'peak', 'moisture', 'odour', 'ambient'];
    const PROBE_PATTERNS = [/probe\s*\d/i, /temp\s*(core|mid|corner)/i, /temp\s*\d/i];

    const discovered: DiscoveredSystem[] = [];

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

      if (!headerRow) continue; // Not a build sheet

      // Detect probe count from headers
      let probeCount = 0;
      for (const cell of headerRow) {
        const lower = (cell || '').toLowerCase().trim();
        if (PROBE_PATTERNS.some(p => p.test(lower))) {
          probeCount++;
        }
      }
      // Default to 9 if we found headers but couldn't count probes
      if (probeCount === 0) probeCount = 9;

      // Check if there's data beyond the header
      const dataRows = dataCountData[i]?.values || [];
      const hasData = dataRows.length > headerRowIdx + 1;

      discovered.push({ tabName, probeCount, hasData });
    }

    return new Response(JSON.stringify({
      success: true,
      systems: discovered,
      totalTabs: allTabs.length,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store', // always fresh — devices must agree on build list
      },
    });

  } catch (error) {
    console.error('Error discovering systems:', error);
    return new Response(JSON.stringify({
      error: 'Failed to discover systems',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};

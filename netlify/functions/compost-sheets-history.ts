import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

interface ParsedEntry {
  date: string;
  time: string;
  weather: string;
  ambientMin: number | null;
  ambientMax: number | null;
  moisture: string;
  odour: string;
  probes: (number | null)[];
  average: number | null;
  peak: number | null;
  ventTemps: string;
  visualNotes: string;
  generalNotes: string;
}

function parseRow(row: string[]): ParsedEntry {
  const parseNum = (val: string | undefined): number | null => {
    if (!val || val === '') return null;
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  };

  return {
    date: row[0] || '',
    time: row[1] || '',
    weather: row[2] || '',
    ambientMin: parseNum(row[3]),
    ambientMax: parseNum(row[4]),
    moisture: row[5] || '',
    odour: row[6] || '',
    probes: Array.from({ length: 9 }, (_, i) => parseNum(row[7 + i])),
    // Columns 16 (R) and 17 (S) are avg/peak (formulas)
    average: parseNum(row[17]),
    peak: parseNum(row[18]),
    ventTemps: row[19] || '',
    visualNotes: row[20] || '',
    generalNotes: row[21] || '',
  };
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

    const url = new URL(request.url);
    const tab = url.searchParams.get('tab');
    const limit = parseInt(url.searchParams.get('limit') || '30');

    if (!tab) {
      return new Response(JSON.stringify({ error: 'Missing ?tab= parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sheets = getGoogleSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: tab,
    });

    const rows = response.data.values || [];
    // Skip header row(s), parse data rows
    const dataRows = rows.slice(1);
    const entries = dataRows
      .map(row => parseRow(row))
      .filter(e => e.date !== '') // skip empty rows
      .slice(-limit); // take last N entries

    return new Response(JSON.stringify({
      success: true,
      entries,
      total: dataRows.length,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error reading history:', error);
    return new Response(JSON.stringify({
      error: 'Failed to read history',
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

import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

const TAB = 'Build Info';
const HEADERS = ['System', 'Notes', 'Summary', 'UpdatedAt'];
const RANGE = `'${TAB}'!A:D`;

function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function ensureTab(sheets: ReturnType<typeof getSheetsClient>, spreadsheetId: string): Promise<number> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets?.find(s => s.properties?.title === TAB);
  if (existing?.properties?.sheetId != null) return existing.properties.sheetId;

  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
  });
  const newId = res.data.replies?.[0]?.addSheet?.properties?.sheetId;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${TAB}'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [HEADERS] },
  });

  return newId!;
}

interface BuildInfo {
  system: string;
  notes: string;
  summary: string;
  updatedAt: string;
}

function parseRows(values: string[][]): BuildInfo[] {
  if (!values || values.length < 2) return [];
  return values.slice(1).map(r => ({
    system: r[0] || '',
    notes: r[1] || '',
    summary: r[2] || '',
    updatedAt: r[3] || '',
  })).filter(r => r.system);
}

export default async (request: Request, _context: Context) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  try {
    const spreadsheetId = process.env.COMPOST_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return new Response(JSON.stringify({ error: 'Spreadsheet ID not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const sheets = getSheetsClient();
    await ensureTab(sheets, spreadsheetId);

    if (request.method === 'GET') {
      const url = new URL(request.url);
      const system = url.searchParams.get('system');
      if (!system) {
        return new Response(JSON.stringify({ error: 'Missing ?system= parameter' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
      const rows = parseRows((res.data.values as string[][]) || []);
      const match = rows.find(r => r.system === system);
      return new Response(JSON.stringify({
        success: true,
        info: match || { system, notes: '', summary: '', updatedAt: '' },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const system = body.system as string;
      if (!system) {
        return new Response(JSON.stringify({ error: 'Missing system' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
      const values = (res.data.values as string[][]) || [];
      let foundIndex = -1;
      for (let i = 1; i < values.length; i++) {
        if (values[i][0] === system) { foundIndex = i; break; }
      }

      const existing = foundIndex >= 0 ? values[foundIndex] : ['', '', '', ''];
      const notes = body.notes !== undefined ? String(body.notes) : (existing[1] || '');
      const summary = body.summary !== undefined ? String(body.summary) : (existing[2] || '');
      const updatedAt = new Date().toISOString();
      const row = [system, notes, summary, updatedAt];

      if (foundIndex >= 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${TAB}'!A${foundIndex + 1}:D${foundIndex + 1}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [row] },
        });
      } else {
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: RANGE,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [row] },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        info: { system, notes, summary, updatedAt },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    console.error('Error in build-info:', error);
    return new Response(JSON.stringify({
      error: 'Failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};

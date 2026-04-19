import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

const MEDIA_TAB = 'Media';
const HEADERS = ['System', 'Slot', 'Order', 'FileId', 'ThumbnailUrl', 'WebViewLink', 'MimeType', 'Caption', 'Date', 'AddedAt', 'Transform'];
const RANGE = `'${MEDIA_TAB}'!A:K`;

function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function ensureMediaTab(sheets: ReturnType<typeof getSheetsClient>, spreadsheetId: string): Promise<number> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets?.find(s => s.properties?.title === MEDIA_TAB);
  if (existing?.properties?.sheetId != null) {
    // Make sure the Transform header is present (retrofit older sheets)
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${MEDIA_TAB}'!A1:Z1`,
    });
    const headerRow = (headerRes.data.values?.[0] as string[]) || [];
    if (!headerRow.includes('Transform')) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${MEDIA_TAB}'!K1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [['Transform']] },
      });
    }
    return existing.properties.sheetId;
  }

  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: MEDIA_TAB } } }] },
  });
  const newId = res.data.replies?.[0]?.addSheet?.properties?.sheetId;

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${MEDIA_TAB}'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [HEADERS] },
  });

  return newId!;
}

interface MediaRow {
  system: string;
  slot: string;
  order: number;
  fileId: string;
  thumbnailUrl: string;
  webViewLink: string;
  mimeType: string;
  caption: string;
  date: string;
  addedAt: string;
  transform: string;
}

function parseRows(values: string[][]): MediaRow[] {
  if (!values || values.length < 2) return [];
  return values.slice(1).map(r => ({
    system: r[0] || '',
    slot: r[1] || '',
    order: Number(r[2]) || 0,
    fileId: r[3] || '',
    thumbnailUrl: r[4] || '',
    webViewLink: r[5] || '',
    mimeType: r[6] || '',
    caption: r[7] || '',
    date: r[8] || '',
    addedAt: r[9] || '',
    transform: r[10] || '',
  })).filter(r => r.fileId);
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
    const sheetId = await ensureMediaTab(sheets, spreadsheetId);

    if (request.method === 'GET') {
      const url = new URL(request.url);
      const system = url.searchParams.get('system');
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: RANGE,
      });
      const all = parseRows((res.data.values as string[][]) || []);
      const filtered = system ? all.filter(r => r.system === system) : all;
      filtered.sort((a, b) => a.slot.localeCompare(b.slot) || a.order - b.order);
      return new Response(JSON.stringify({ success: true, items: filtered }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const action = body.action as string;

      if (action === 'add') {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: RANGE,
        });
        const all = parseRows((res.data.values as string[][]) || []);
        const existing = all.filter(r => r.system === body.system && r.slot === body.slot);
        const nextOrder = existing.length > 0 ? Math.max(...existing.map(r => r.order)) + 1 : 0;

        const row = [
          body.system || '',
          body.slot || '',
          nextOrder,
          body.fileId || '',
          body.thumbnailUrl || '',
          body.webViewLink || '',
          body.mimeType || '',
          body.caption || '',
          body.date || '',
          new Date().toISOString(),
          '',
        ];

        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: RANGE,
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          requestBody: { values: [row] },
        });

        return new Response(JSON.stringify({ success: true, order: nextOrder }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      if (action === 'remove') {
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: RANGE,
        });
        const values = (res.data.values as string[][]) || [];
        const rowsToDelete: number[] = [];
        for (let i = 1; i < values.length; i++) {
          const r = values[i];
          if (r[0] === body.system && r[1] === body.slot && r[3] === body.fileId) {
            rowsToDelete.push(i);
          }
        }
        if (rowsToDelete.length > 0) {
          const requests = rowsToDelete.reverse().map(idx => ({
            deleteDimension: {
              range: {
                sheetId,
                dimension: 'ROWS' as const,
                startIndex: idx,
                endIndex: idx + 1,
              },
            },
          }));
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: { requests },
          });
        }
        return new Response(JSON.stringify({ success: true, removed: rowsToDelete.length }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      if (action === 'updateCaption' || action === 'updateTransform') {
        const col = action === 'updateCaption' ? 'H' : 'K';
        const value = action === 'updateCaption' ? (body.caption || '') : (body.transform || '');
        const res = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: RANGE,
        });
        const values = (res.data.values as string[][]) || [];
        for (let i = 1; i < values.length; i++) {
          const r = values[i];
          if (r[0] === body.system && r[1] === body.slot && r[3] === body.fileId) {
            await sheets.spreadsheets.values.update({
              spreadsheetId,
              range: `'${MEDIA_TAB}'!${col}${i + 1}`,
              valueInputOption: 'USER_ENTERED',
              requestBody: { values: [[value]] },
            });
            break;
          }
        }
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }

      return new Response(JSON.stringify({ error: 'Unknown action' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    console.error('Error in media index:', error);
    return new Response(JSON.stringify({
      error: 'Failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};

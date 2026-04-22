import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

const TAB = 'Build Info';
const HEADERS = [
  'System',       // A
  'Notes',        // B
  'Summary',      // C
  'BuildType',    // D
  'MulchBins',    // E
  'MulchType',    // F
  'Dimensions',   // G  (JSON: { shape, lengthCm, widthCm, diameterCm, heightCm })
  'ProbeLabels',  // H  (JSON array of strings)
  'UpdatedAt',    // I
];
const RANGE = `'${TAB}'!A:I`;
const HEADER_RANGE = `'${TAB}'!A1:I1`;

function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function ensureTabAndHeaders(
  sheets: ReturnType<typeof getSheetsClient>,
  spreadsheetId: string,
): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets?.find(s => s.properties?.title === TAB);

  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${TAB}'!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [HEADERS] },
    });
    return;
  }

  // Tab exists — ensure headers cover all expected columns (one-time migration
  // from the old 4-column layout). Only extend missing columns; don't overwrite
  // existing column A/B/C/D names that may differ in capitalisation.
  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: HEADER_RANGE,
  });
  const current = (headerRes.data.values?.[0] as string[]) || [];
  if (current.length < HEADERS.length) {
    const merged = HEADERS.map((h, i) => current[i] || h);
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: HEADER_RANGE,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [merged] },
    });
  }
}

interface BuildInfo {
  system: string;
  notes: string;
  summary: string;
  buildType: string;
  mulchBins: number | null;
  mulchType: string;
  dimensions: unknown | null;
  probeLabels: string[] | null;
  updatedAt: string;
}

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function parseRow(r: string[]): BuildInfo {
  const mulchBinsRaw = r[4];
  const mulchBins = mulchBinsRaw && mulchBinsRaw !== '' ? Number(mulchBinsRaw) : null;
  return {
    system: r[0] || '',
    notes: r[1] || '',
    summary: r[2] || '',
    buildType: r[3] || '',
    mulchBins: mulchBins !== null && !isNaN(mulchBins) ? mulchBins : null,
    mulchType: r[5] || '',
    dimensions: parseJson(r[6]),
    probeLabels: parseJson<string[]>(r[7]),
    updatedAt: r[8] || '',
  };
}

function parseRows(values: string[][]): BuildInfo[] {
  if (!values || values.length < 2) return [];
  return values.slice(1).map(parseRow).filter(r => r.system);
}

function buildRow(info: BuildInfo): string[] {
  return [
    info.system,
    info.notes,
    info.summary,
    info.buildType,
    info.mulchBins !== null ? String(info.mulchBins) : '',
    info.mulchType,
    info.dimensions ? JSON.stringify(info.dimensions) : '',
    info.probeLabels ? JSON.stringify(info.probeLabels) : '',
    info.updatedAt,
  ];
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

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
        status: 500, headers: JSON_HEADERS,
      });
    }

    const sheets = getSheetsClient();
    await ensureTabAndHeaders(sheets, spreadsheetId);

    if (request.method === 'GET') {
      const url = new URL(request.url);
      const system = url.searchParams.get('system');
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
      const rows = parseRows((res.data.values as string[][]) || []);

      if (system) {
        const match = rows.find(r => r.system === system);
        return new Response(JSON.stringify({
          success: true,
          info: match || {
            system, notes: '', summary: '', buildType: '',
            mulchBins: null, mulchType: '', dimensions: null, probeLabels: null,
            updatedAt: '',
          },
        }), { status: 200, headers: JSON_HEADERS });
      }

      // No ?system= → return all rows. Used on app init to bulk-merge.
      return new Response(JSON.stringify({ success: true, infos: rows }), {
        status: 200, headers: JSON_HEADERS,
      });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const system = (body.system as string)?.trim();
      if (!system) {
        return new Response(JSON.stringify({ error: 'Missing system' }), {
          status: 400, headers: JSON_HEADERS,
        });
      }

      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
      const values = (res.data.values as string[][]) || [];
      let foundIndex = -1;
      for (let i = 1; i < values.length; i++) {
        if (values[i][0] === system) { foundIndex = i; break; }
      }
      const existing: BuildInfo = foundIndex >= 0
        ? parseRow(values[foundIndex])
        : {
            system, notes: '', summary: '', buildType: '',
            mulchBins: null, mulchType: '', dimensions: null, probeLabels: null,
            updatedAt: '',
          };

      // Merge: any provided field overrides existing; undefined leaves it alone.
      const merged: BuildInfo = {
        system,
        notes: body.notes !== undefined ? String(body.notes) : existing.notes,
        summary: body.summary !== undefined ? String(body.summary) : existing.summary,
        buildType: body.buildType !== undefined ? String(body.buildType) : existing.buildType,
        mulchBins: body.mulchBins !== undefined
          ? (body.mulchBins === null ? null : Number(body.mulchBins))
          : existing.mulchBins,
        mulchType: body.mulchType !== undefined ? String(body.mulchType) : existing.mulchType,
        dimensions: body.dimensions !== undefined ? body.dimensions : existing.dimensions,
        probeLabels: body.probeLabels !== undefined ? body.probeLabels : existing.probeLabels,
        updatedAt: new Date().toISOString(),
      };

      const row = buildRow(merged);
      if (foundIndex >= 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${TAB}'!A${foundIndex + 1}:I${foundIndex + 1}`,
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

      return new Response(JSON.stringify({ success: true, info: merged }), {
        status: 200, headers: JSON_HEADERS,
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: JSON_HEADERS,
    });
  } catch (error) {
    console.error('Error in build-info:', error);
    return new Response(JSON.stringify({
      error: 'Failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: JSON_HEADERS });
  }
};

import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

// A "trial run" is one protocol experiment (e.g. the 5-day germination test
// started 19 Jul) that many per-pile GrowTrials belong to. It holds the shared
// start date, planned duration, seeds sown and — critically — the control pots,
// which are not builds and so have nowhere else to live.
//
// Shared/global tab: rows are keyed by RunId, not by system.

const TAB = 'Trial Runs';
const HEADERS = [
  'RunId',        // A  stable id, generated client-side
  'Type',         // B  'germination' | 'growth-test' | 'crop'
  'StartDate',    // C  YYYY-MM-DD
  'PlannedDays',  // D  number (blank = open-ended)
  'SeedsSown',    // E  number (blank = not recorded)
  'Controls',     // F  JSON: [{ id, label, measurements }]
  'Notes',        // G
  'UpdatedAt',    // H  ISO timestamp
];
const RANGE = `'${TAB}'!A:H`;
const HEADER_RANGE = `'${TAB}'!A1:H1`;

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

  // Tab exists — only ever EXTEND the header row (never reorder or rename
  // existing columns). New columns must be appended at the end.
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

/** Measured values keyed by field id from `src/utils/trialFields.ts`. */
type Measurements = Record<string, number | string | boolean | null>;

interface TrialControl {
  id: string;
  label: string;
  measurements: Measurements;
}

interface TrialRun {
  runId: string;
  type: string;
  startDate: string;
  plannedDays: number | null;
  seedsSown: number | null;
  controls: TrialControl[];
  notes: string;
  updatedAt: string;
}

function parseNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return isNaN(n) ? null : n;
}

/**
 * Controls are stored as a JSON blob in one cell — a hand-edit in the sheet can
 * easily make it unparseable. Never throw: bad JSON, a non-array, or malformed
 * entries all degrade to an empty list so the rest of the run still loads.
 */
function parseControls(raw: string | undefined): TrialControl[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: TrialControl[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const id = typeof c.id === 'string' ? c.id : '';
    if (!id) continue;
    const measurements = (c.measurements && typeof c.measurements === 'object'
      && !Array.isArray(c.measurements))
      ? c.measurements as Measurements
      : {};
    out.push({
      id,
      label: typeof c.label === 'string' ? c.label : id,
      measurements,
    });
  }
  return out;
}

function parseRow(r: string[]): TrialRun {
  return {
    runId: r[0] || '',
    type: r[1] || '',
    startDate: r[2] || '',
    plannedDays: parseNumber(r[3]),
    seedsSown: parseNumber(r[4]),
    controls: parseControls(r[5]),
    notes: r[6] || '',
    updatedAt: r[7] || '',
  };
}

function parseRows(values: string[][]): TrialRun[] {
  if (!values || values.length < 2) return [];
  return values.slice(1).map(parseRow).filter(r => r.runId);
}

function buildRow(run: TrialRun): string[] {
  return [
    run.runId,
    run.type,
    run.startDate,
    run.plannedDays !== null ? String(run.plannedDays) : '',
    run.seedsSown !== null ? String(run.seedsSown) : '',
    run.controls.length > 0 ? JSON.stringify(run.controls) : '',
    run.notes,
    run.updatedAt,
  ];
}

function blankRun(runId: string): TrialRun {
  return {
    runId, type: '', startDate: '', plannedDays: null, seedsSown: null,
    controls: [], notes: '', updatedAt: '',
  };
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
      const runId = url.searchParams.get('runId');
      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
      const rows = parseRows((res.data.values as string[][]) || []);

      if (runId) {
        // FIRST match wins — POST below updates the first matching row, so the
        // read path must resolve to that same row.
        const match = rows.find(r => r.runId === runId) || null;
        return new Response(JSON.stringify({ success: true, run: match }), {
          status: 200, headers: JSON_HEADERS,
        });
      }

      // No ?runId= → every run. Used on app init.
      return new Response(JSON.stringify({ success: true, runs: rows }), {
        status: 200, headers: JSON_HEADERS,
      });
    }

    if (request.method === 'POST') {
      const body = await request.json();
      const runId = (body.runId as string)?.trim();
      if (!runId) {
        return new Response(JSON.stringify({ error: 'Missing runId' }), {
          status: 400, headers: JSON_HEADERS,
        });
      }

      const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
      const values = (res.data.values as string[][]) || [];
      // Scan from the top and take the FIRST row whose RunId matches, exactly
      // like compost-build-info.ts. Client-side lookups must be first-wins too.
      let foundIndex = -1;
      for (let i = 1; i < values.length; i++) {
        if (values[i][0] === runId) { foundIndex = i; break; }
      }
      const existing: TrialRun = foundIndex >= 0
        ? parseRow(values[foundIndex])
        : blankRun(runId);

      // Merge: any provided field overrides existing; undefined leaves it alone.
      const merged: TrialRun = {
        runId,
        type: body.type !== undefined ? String(body.type) : existing.type,
        startDate: body.startDate !== undefined ? String(body.startDate) : existing.startDate,
        plannedDays: body.plannedDays !== undefined
          ? (body.plannedDays === null || body.plannedDays === '' || isNaN(Number(body.plannedDays))
              ? null
              : Number(body.plannedDays))
          : existing.plannedDays,
        seedsSown: body.seedsSown !== undefined
          ? (body.seedsSown === null || body.seedsSown === '' || isNaN(Number(body.seedsSown))
              ? null
              : Number(body.seedsSown))
          : existing.seedsSown,
        // Controls are replaced wholesale when provided (they're one JSON cell),
        // and run through the same defensive parse as a sheet read.
        controls: body.controls !== undefined
          ? parseControls(JSON.stringify(body.controls ?? []))
          : existing.controls,
        notes: body.notes !== undefined ? String(body.notes) : existing.notes,
        updatedAt: new Date().toISOString(),
      };

      const row = buildRow(merged);
      if (foundIndex >= 0) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${TAB}'!A${foundIndex + 1}:H${foundIndex + 1}`,
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

      return new Response(JSON.stringify({ success: true, run: merged }), {
        status: 200, headers: JSON_HEADERS,
      });
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: JSON_HEADERS,
    });
  } catch (error) {
    console.error('Error in trial-runs:', error);
    return new Response(JSON.stringify({
      error: 'Failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: JSON_HEADERS });
  }
};

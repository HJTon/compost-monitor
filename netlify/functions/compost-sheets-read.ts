import { sheetIdForTab, FARM_VARY_HEADERS } from './_lib/farms';
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

// ── Chaffed pickle (CP) ─────────────────────────────────────────────────────
// The Green Loop collector app (green-loop-app/netlify/functions/_lib/chaff-highlight.ts) shades
// a Bin Tracker "Content from" cell bright yellow #ffe600 when that business's bokashi had been
// refilled with chaffed pickle instead of Zing. With `?cp=1` we return, per row index (same
// indexing as `data`), the names whose cell carries that colour. Rows not listed are all Zing.
// Keep CP_BRIGHT in step with chaff-highlight.ts.
const CP_BRIGHT = { red: 0xff / 255, green: 0xe6 / 255, blue: 0 };
const NAME_COLS = [1, 2, 3, 4, 5, 12]; // B–F and M ("Content from 6+")

async function readChaffedPickle(
  sheets: ReturnType<typeof getGoogleSheetsClient>,
  spreadsheetId: string,
): Promise<Record<number, string[]>> {
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: ["'Bin Tracker'!A1:M"],
    fields: 'sheets(data(rowData(values(formattedValue,effectiveFormat(backgroundColor)))))',
  });
  const near = (a: number | null | undefined, b: number) => Math.abs((a ?? 0) - b) < 0.003;
  const out: Record<number, string[]> = {};
  (res.data.sheets?.[0]?.data?.[0]?.rowData ?? []).forEach((rd, i) => {
    if (i === 0) return;
    const names = NAME_COLS.flatMap((col) => {
      const cell = rd.values?.[col];
      const c = cell?.effectiveFormat?.backgroundColor;
      const name = (cell?.formattedValue ?? '').trim();
      return name && c && near(c.red, CP_BRIGHT.red) && near(c.green, CP_BRIGHT.green) && near(c.blue, CP_BRIGHT.blue)
        ? [name] : [];
    });
    if (names.length) out[i] = names;
  });
  return out;
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
    const url = new URL(request.url);
    const tab = url.searchParams.get('tab');
    if (!tab) {
      return new Response(JSON.stringify({ error: 'Missing ?tab= parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Bin Tracker lives in the shared sheet; every other tab (and __tabs__) in the farm's own.
    const spreadsheetId = sheetIdForTab(request, tab);

    const sheets = getGoogleSheetsClient();

    // List all tab names
    if (tab === '__tabs__') {
      const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties.title' });
      const tabNames = meta.data.sheets?.map(s => s.properties?.title) || [];
      return new Response(JSON.stringify({ success: true, tabs: tabNames }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const wantCp = tab === 'Bin Tracker' && url.searchParams.get('cp') === '1';
    const [response, cp] = await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${tab}'`,
      }),
      wantCp ? readChaffedPickle(sheets, spreadsheetId).catch((e) => {
        console.error('CP colour read failed:', e);
        return null; // the bins still load; the app just can't say Zing vs CP
      }) : Promise.resolve(undefined),
    ]);

    return new Response(JSON.stringify({
      success: true,
      data: response.data.values || [],
      rowCount: (response.data.values || []).length,
      ...(cp !== undefined ? { cp } : {}),
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        // CDN-only cache to absorb repeat reads (e.g. the Sampling Log read
        // fired on every Analyse/Compare load) without browsers caching.
        'Netlify-CDN-Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120',
        ...FARM_VARY_HEADERS,
      },
    });
  } catch (error) {
    console.error('Error reading sheet:', error);
    return new Response(JSON.stringify({
      error: 'Failed to read sheet',
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

import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

const TAB_NAME = 'Readiness Checks';

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const HEADERS = [
  'ID', 'System', 'Date', 'Label',
  'Bacterial Biomass', 'Bacterial StdDev', 'Bacterial StdDev %',
  'Actinobacterial Biomass', 'Actinobacterial StdDev',
  'Fungal Biomass', 'Fungal StdDev', 'Fungal StdDev %', 'Fungal Diameter',
  'F:B Ratio',
  'Total Protozoa', 'Flagellates', 'Flagellates StdDev',
  'Amoebae', 'Amoebae StdDev',
  'Bact-feeding Nematodes', 'Fungal-feeding Nematodes', 'Predatory Nematodes',
  'Oomycetes Biomass', 'Ciliates', 'Ciliates StdDev', 'Root-feeding Nematodes',
  'Created At',
];

export default async (req: Request, _context: Context) => {
  if (req.method === 'DELETE') {
    return handleDelete(req);
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST or DELETE only' }), { status: 405 });
  }

  try {
    const body = await req.json();
    const { id, systemId, date, label, results, createdAt } = body;

    if (!id || !systemId || !date || !results) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    const sheets = getGoogleSheetsClient();
    const spreadsheetId = process.env.COMPOST_SPREADSHEET_ID!;

    // Ensure the tab exists
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const tabExists = spreadsheet.data.sheets?.some(
      s => s.properties?.title === TAB_NAME
    );

    if (!tabExists) {
      // Create the tab
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: [{
            addSheet: { properties: { title: TAB_NAME } },
          }],
        },
      });
      // Write headers
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${TAB_NAME}'!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [HEADERS] },
      });
    }

    const r = results;
    const row = [
      id,
      systemId,
      date,
      label || '',
      r.bacterialBiomass,
      r.bacterialStdDev,
      r.bacterialStdDevPct,
      r.actinobacterialBiomass,
      r.actinobacterialStdDev,
      r.fungalBiomass,
      r.fungalStdDev,
      r.fungalStdDevPct,
      r.fungalDiameter,
      r.fbRatio,
      r.totalProtozoa,
      r.flagellates,
      r.flagellatesStdDev,
      r.amoebae,
      r.amoebaeStdDev,
      r.bacterialFeedingNematodes,
      r.fungalFeedingNematodes,
      r.predatoryNematodes,
      r.oomycetesBiomass,
      r.ciliates,
      r.ciliatesStdDev,
      r.rootFeedingNematodes,
      createdAt || new Date().toISOString(),
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${TAB_NAME}'!A:A`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Readiness write error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

async function handleDelete(req: Request) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return new Response(JSON.stringify({ error: 'missing id' }), { status: 400 });

    const sheets = getGoogleSheetsClient();
    const spreadsheetId = process.env.COMPOST_SPREADSHEET_ID!;

    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const tab = meta.data.sheets?.find(s => s.properties?.title === TAB_NAME);
    if (!tab?.properties || tab.properties.sheetId == null) {
      return new Response(JSON.stringify({ error: 'tab not found' }), { status: 404 });
    }

    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${TAB_NAME}'!A:A` });
    const rows = res.data.values || [];
    const rowIdx = rows.findIndex(r => r[0] === id);
    if (rowIdx < 0) return new Response(JSON.stringify({ error: 'id not found' }), { status: 404 });

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: tab.properties.sheetId,
              dimension: 'ROWS',
              startIndex: rowIdx,
              endIndex: rowIdx + 1,
            },
          },
        }],
      },
    });

    return new Response(JSON.stringify({ success: true, deletedId: id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Readiness delete error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}

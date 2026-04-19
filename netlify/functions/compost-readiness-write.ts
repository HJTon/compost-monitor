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
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
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

import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

const TAB_NAME = 'Readiness Checks';

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

export default async (req: Request, _context: Context) => {
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'GET only' }), { status: 405 });
  }

  const url = new URL(req.url);
  const systemFilter = url.searchParams.get('system'); // optional: filter by systemId

  try {
    const sheets = getGoogleSheetsClient();
    const spreadsheetId = process.env.COMPOST_SPREADSHEET_ID!;

    // Check if tab exists
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const tabExists = spreadsheet.data.sheets?.some(
      s => s.properties?.title === TAB_NAME
    );

    if (!tabExists) {
      return new Response(JSON.stringify({ checks: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${TAB_NAME}'!A:AA`,
    });

    const rows = res.data.values || [];
    if (rows.length <= 1) {
      return new Response(JSON.stringify({ checks: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Skip header row
    const checks = rows.slice(1)
      .map(row => {
        const num = (i: number) => {
          const v = row[i];
          if (v === undefined || v === null || v === '') return null;
          const n = Number(v);
          return isNaN(n) ? null : n;
        };

        return {
          id: row[0] || '',
          systemId: row[1] || '',
          date: row[2] || '',
          label: row[3] || '',
          results: {
            bacterialBiomass: num(4),
            bacterialStdDev: num(5),
            bacterialStdDevPct: num(6),
            actinobacterialBiomass: num(7),
            actinobacterialStdDev: num(8),
            fungalBiomass: num(9),
            fungalStdDev: num(10),
            fungalStdDevPct: num(11),
            fungalDiameter: num(12),
            fbRatio: num(13),
            totalProtozoa: num(14),
            flagellates: num(15),
            flagellatesStdDev: num(16),
            amoebae: num(17),
            amoebaeStdDev: num(18),
            bacterialFeedingNematodes: num(19),
            fungalFeedingNematodes: num(20),
            predatoryNematodes: num(21),
            oomycetesBiomass: num(22),
            ciliates: num(23),
            ciliatesStdDev: num(24),
            rootFeedingNematodes: num(25),
          },
          createdAt: row[26] || '',
        };
      })
      .filter(c => !systemFilter || c.systemId === systemFilter);

    return new Response(JSON.stringify({ checks }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Readiness read error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

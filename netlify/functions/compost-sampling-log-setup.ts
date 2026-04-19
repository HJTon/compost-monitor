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

const SPREADSHEET_ID = process.env.COMPOST_SPREADSHEET_ID || '1dY7TxghJegPDWUZF51QRmLhWUXVFBcdK5BYzOLsbNAo';
const TAB_NAME = 'Sampling Log';

const HEADERS = [
  'Date', 'Sample ID', 'System', 'Turn', 'System Height (cm)',
  'Probe', 'Sub-sample', 'Temperature (°F)', 'Depth (cm)',
  'Sampling Method', 'Handling', 'Notes',
];

// Helper: create rows for a sampling event with sub-samples
// For probes like "1 a b c, 100F" → 3 rows, temp only on first
function probeRows(
  date: string, sampleId: string, system: string, turn: string, height: string,
  method: string, handling: string, notes: string,
  probes: Array<[string, string, string, string]>, // [probe, sub, temp, depth]
): string[][] {
  return probes.map(([probe, sub, temp, depth]) => [
    date, sampleId, system, turn, height,
    probe, sub, temp, depth,
    method, handling, notes,
  ]);
}

function getAllRows(): string[][] {
  const rows: string[][] = [];

  // ── 1. 28/11/2025 — S1 — Pivot #1 — Initial build, layered samples ──
  const e1base = ['28/11/2025', 'S1', 'Pivot #1', '', '', '', '', '', '', 'Layered', 'On ice — Massey transport 28/11/25', ''];
  for (const layer of ['Wood chip layer 1', 'Bin layer 1', 'Wood chip layer 2', 'Bin layer 2', 'Wood chip layer 3', 'Bin layer 3', 'Wood chip layer 4', 'Bin layer 4', 'Wood chip layer 5']) {
    rows.push([...e1base.slice(0, 5), layer, '', '', '', e1base[9], e1base[10], '']);
  }

  // ── 2. 05/12/2025 — S1 — Pivot #2 — Turn 1 ──
  rows.push(...probeRows('05/12/2025', 'S1', 'Pivot #2', '1', '', '', 'Posted on ice 10/12/2025', '', [
    ['1', '', '160', '10'],
    ['3', '', '130', '28'],
    ['5', '', '130', '25'],
    ['6', '', '116', '20'],
    ['7', '', '144', '30'],
    ['9', '', '138', '40'],
    ['10', '', '149', '10'],
  ]));
  // Note on probe 1 and 10
  rows[rows.length - 7][11] = 'Core sample, top 10cm';
  rows[rows.length - 1][11] = 'Base of unit when tipped at turn';

  // ── 3. 09/12/2025 — S2 — Pivot #2 — Turn 2 ──
  rows.push(...probeRows('09/12/2025', 'S2', 'Pivot #2', '2', '', '', 'Posted on ice 10/12/2025', '', [
    ['1', '', '140', '10'],
    ['3', '', '130', '35'],
    ['5', '', '94', '35'],
    ['6', '', '116', '30'],
    ['7', '', '96', '20'],
    ['9', '', '90', '25'],
    ['10', '', '104', '10'],
  ]));
  rows[rows.length - 7][11] = 'Top';
  rows[rows.length - 1][11] = 'Base of unit when tipped at turn';

  // ── 4. 12/12/2025 — S3 — Pivot #2 — Turn 3 ──
  rows.push(...probeRows('12/12/2025', 'S3', 'Pivot #2', '3', '', '', 'Refrigerated then frozen. On ice — Massey transport 14/01/26', '', [
    ['1', '', '140', '10'],
    ['3', '', '120', '38'],
    ['5', '', '94', '30'],
    ['6', '', '120', '20'],
    ['7', '', '98', '30'],
    ['9', '', '98', '18'],
    ['10', '', '104', '10'],
  ]));
  rows[rows.length - 7][11] = 'Top';
  rows[rows.length - 1][11] = 'Base of unit when tipped at turn';

  // ── 5. 18/12/2025 — S4 — Pivot #2 — Height 52cm ──
  rows.push(...probeRows('18/12/2025', 'S4', 'Pivot #2', '', '52', '', 'Frozen. On ice — Massey transport 14/01/26', '', [
    ['1', '', '104', '10'],
    ['3', '', '72', '20'],
    ['5', '', '84', '30'],
    ['6', '', '120', '35'],
    ['7', '', '104', '10'],
    ['9', '', '86', '25'],
  ]));
  rows[rows.length - 6][11] = 'Top';

  // ── 6. 18/12/2025 — S2 — Pivot #1 — Height 58cm ──
  rows.push(...probeRows('18/12/2025', 'S2', 'Pivot #1', '', '58', '', 'Frozen. On ice — Massey transport 14/01/26', '', [
    ['1', '', '124', '10'],
    ['3', '', '118', '20'],
    ['5', '', '100', '50'],
    ['6', '', '120', '35'],
    ['7', '', '124', '10'],
    ['9', '', '100', '40'],
  ]));
  rows[rows.length - 6][11] = 'Top';
  rows[rows.length - 2][11] = 'Top';

  // ── 7. 05/01/2026 — S1 — Pivot #3 — Initial build, layered ──
  for (const layer of ['Wood chip layer', 'Bin layer 1', 'Bin layer 2', 'Bin layer 3', 'Bin layer 4', 'Juice from bin', 'Juice from bin']) {
    rows.push(['05/01/2026', 'S1', 'Pivot #3', '', '', layer, '', '', '', 'Layered', 'Frozen. On ice — Massey transport 14/01/26', 'Initial build']);
  }

  // ── 8. 08/01/2026 — S1 — Pivot #4 — Initial build, layered ──
  for (const layer of ['Wood chip layer', 'Bin layer 1', 'Bin layer 2', 'Bin layer 3', 'Bin layer 4', 'Juice from bin', 'Juice from bin']) {
    rows.push(['08/01/2026', 'S1', 'Pivot #4', '', '', layer, '', '', '', 'Layered', 'Frozen. On ice — Massey transport 14/01/26', 'Initial build']);
  }

  // ── 9. 14/01/2026 — S3 — Pivot #1 — Auger, sub-samples a–d ──
  rows.push(...probeRows('14/01/2026', 'S3', 'Pivot #1', '', '', 'Auger', 'On ice — Massey transport', '', [
    ['1', 'a', '110', '34'], ['1', 'b', '116', '45'], ['1', 'c', '92', '46'], ['1', 'd', '106', '56'],
    ['6', 'a', '106', '41'], ['6', 'b', '104', '46'], ['6', 'c', '100', '41'], ['6', 'd', '94', '51'],
    ['9', 'a', '84', '29'], ['9', 'b', '90', '39'], ['9', 'c', '86', '49'], ['9', 'd', '82', '46'],
  ]));

  // ── 10. 14/01/2026 — S5 — Pivot #2 — Auger, no depths ──
  rows.push(...probeRows('14/01/2026', 'S5', 'Pivot #2', '', '', 'Auger', 'On ice — Massey transport', 'No depth taken — loose sample consistency', [
    ['1', 'a', '72', ''], ['1', 'b', '72', ''],
    ['3', 'a', '72', ''], ['3', 'b', '72', ''],
    ['6', 'a', '74', ''], ['6', 'b', '74', ''],
    ['9', 'a', '74', ''], ['9', 'b', '74', ''],
  ]));

  // ── 11. 14/01/2026 — S2 — Pivot #3 — Auger, sub-samples a–d ──
  rows.push(...probeRows('14/01/2026', 'S2', 'Pivot #3', '', '', 'Auger', 'On ice — Massey transport', '', [
    ['1', 'a', '154', '24'], ['1', 'b', '148', '35'], ['1', 'c', '152', '44'], ['1', 'd', '140', '41'],
    ['6', 'a', '138', '31'], ['6', 'b', '140', '41'], ['6', 'c', '138', '31'], ['6', 'd', '128', '56'],
    ['9', 'a', '114', '29'], ['9', 'b', '114', '39'], ['9', 'c', '118', '49'], ['9', 'd', '106', '51'],
  ]));

  // ── 12. 14/01/2026 — S2 — Pivot #4 — Auger, sub-samples a–d ──
  rows.push(...probeRows('14/01/2026', 'S2', 'Pivot #4', '', '', 'Auger', 'On ice — Massey transport', '', [
    ['1', 'a', '152', '30'], ['1', 'b', '146', '40'], ['1', 'c', '146', '50'], ['1', 'd', '118', '62'],
    ['6', 'a', '146', '33'], ['6', 'b', '144', '43'], ['6', 'c', '136', '53'], ['6', 'd', '110', '60'],
    ['9', 'a', '122', '13'], ['9', 'b', '130', '23'], ['9', 'c', '137', '37'], ['9', 'd', '122', '47'],
  ]));

  // ── 13. 19/01/2026 — S3 — Pivot #4 — Turn 1 ──
  rows.push(...probeRows('19/01/2026', 'S3', 'Pivot #4', '1', '70', '', 'Frozen', 'Pre-turn 70cm, post-turn 72cm', [
    ['1', '', '114', '60'],
    ['3', '', '126', '50'],
    ['5', '', '122', '40'],
    ['6', '', '140', '35'],
    ['7', '', '110', '30'],
    ['9', '', '128', '15'],
    ['10', '', '126', '5'],
  ]));
  rows[rows.length - 1][11] = 'Bottom of cube centre, 5-10cm';

  // ── 14. 29/01/2026 — S4 — Pivot #4 — Turn 2 ──
  rows.push(...probeRows('29/01/2026', 'S4', 'Pivot #4', '2', '62', '', 'Frozen', '', [
    ['1', '', '162', '52'],
    ['3', '', '114', '28'],
    ['5', '', '130', '47'],
    ['6', '', '120', '22'],
    ['7', '', '108', '32'],
    ['9', '', '98', '12'],
    ['10', '', '120', '5'],
  ]));
  rows[rows.length - 7][11] = 'Top';
  rows[rows.length - 2][11] = 'Top';
  rows[rows.length - 1][11] = 'Bottom of cube centre, 5-10cm';

  // ── 15. 05/02/2026 — S5 — Pivot #4 — Turn 3 ──
  rows.push(...probeRows('05/02/2026', 'S5', 'Pivot #4', '3', '50', '', 'Dug into system. Frozen', '', [
    ['1', '', '128', '36'],
    ['3', '', '118', '20'],
    ['5', '', '110', '20'],
    ['6', '', '126', '45'],
    ['7', '', '126', '15'],
    ['9', '', '120', '26'],
    ['10', '', '110', '5'],
  ]));
  rows[rows.length - 1][11] = 'Bottom of cube centre, 5-10cm';

  // ── 16. 15/02/2026 — S6 — Pivot #4 — Height 50cm, new tool ──
  rows.push(...probeRows('15/02/2026', 'S6', 'Pivot #4', '', '50', 'New tool', 'Transported on ice', '', [
    ['1', 'a', '100', ''], ['1', 'b', '', ''], ['1', 'c', '', ''],
    ['3', 'a', '96', ''], ['3', 'b', '', ''], ['3', 'c', '', ''],
    ['6', 'a', '90', ''], ['6', 'b', '', ''], ['6', 'c', '', ''],
    ['7', 'a', '88', ''], ['7', 'b', '', ''], ['7', 'c', '', ''],
  ]));

  // ── 17. 15/02/2026 — S3 — Pivot #3 — new tool ──
  rows.push(...probeRows('15/02/2026', 'S3', 'Pivot #3', '', '', 'New tool', 'Transported on ice', '', [
    ['1', 'a', '116', ''], ['1', 'b', '', ''], ['1', 'c', '', ''],
    ['3', 'a', '104', ''], ['3', 'b', '', ''], ['3', 'c', '', ''],
    ['6', 'a', '98', ''], ['6', 'b', '', ''], ['6', 'c', '', ''],
    ['7', 'a', '98', ''], ['7', 'b', '', ''], ['7', 'c', '', ''],
  ]));

  // ── 18. 15/02/2026 — S6 — Pivot #2 — new tool, no depths ──
  rows.push(...probeRows('15/02/2026', 'S6', 'Pivot #2', '', '', 'New tool', 'Transported on ice', 'No depth taken — loose sample consistency', [
    ['1', 'a', '100', ''], ['1', 'b', '', ''], ['1', 'c', '', ''],
    ['3', 'a', '88', ''], ['3', 'b', '', ''], ['3', 'c', '', ''],
    ['6', 'a', '88', ''], ['6', 'b', '', ''], ['6', 'c', '', ''],
    ['7', 'a', '86', ''], ['7', 'b', '', ''], ['7', 'c', '', ''],
  ]));

  // ── 19. 15/02/2026 — S4 — Pivot #1 — new tool ──
  rows.push(...probeRows('15/02/2026', 'S4', 'Pivot #1', '', '', 'New tool', 'Transported on ice', '', [
    ['1', 'a', '94', ''], ['1', 'b', '', ''], ['1', 'c', '', ''],
    ['3', 'a', '90', ''], ['3', 'b', '', ''], ['3', 'c', '', ''],
    ['6', 'a', '100', ''], ['6', 'b', '', ''], ['6', 'c', '', ''],
    ['7', 'a', '92', ''], ['7', 'b', '', ''], ['7', 'c', '', ''],
  ]));

  // ── 20. 15/02/2026 — S1 — Carbon Cube Cycle 1 — new tool ──
  rows.push(...probeRows('15/02/2026', 'S1', 'Carbon Cube Cycle 1', '', '', 'New tool', 'Transported on ice', '', [
    ['1', 'a', '130', ''], ['1', 'b', '', ''], ['1', 'c', '', ''],
    ['3', 'a', '120', ''], ['3', 'b', '', ''], ['3', 'c', '', ''],
    ['6', 'a', '130', ''], ['6', 'b', '', ''], ['6', 'c', '', ''],
    ['7', 'a', '110', ''], ['7', 'b', '', ''], ['7', 'c', '', ''],
  ]));

  // ── 21. 15/02/2026 — S1 — Carbon Cube Cycle 2 — new tool ──
  rows.push(...probeRows('15/02/2026', 'S1', 'Carbon Cube Cycle 2', '', '', 'New tool', 'Transported on ice', '', [
    ['1', 'a', '130', ''], ['1', 'b', '', ''], ['1', 'c', '', ''],
    ['3', 'a', '130', ''], ['3', 'b', '', ''], ['3', 'c', '', ''],
    ['6', 'a', '120', ''], ['6', 'b', '', ''], ['6', 'c', '', ''],
    ['7', 'a', '140', ''], ['7', 'b', '', ''], ['7', 'c', '', ''],
  ]));

  // ── 22. 15/02/2026 — S1 — Cylinder #3 — new tool ──
  rows.push(...probeRows('15/02/2026', 'S1', 'Cylinder #3', '', '', 'New tool', 'Transported on ice', '', [
    ['1', 'a', '100', ''], ['1', 'b', '', ''], ['1', 'c', '', ''],
    ['2', 'a', '98', ''], ['2', 'c', '', ''],
    ['3', 'a', '102', ''], ['3', 'b', '', ''],
  ]));
  // Note positions
  rows[rows.length - 7][11] = 'Deep bottom';
  rows[rows.length - 4][11] = 'Mid';
  rows[rows.length - 2][11] = 'Mid top';

  // ── 23. 05/04/2026 — S7 — Pivot #4 — Height 47cm ──
  rows.push(...probeRows('05/04/2026', 'S7', 'Pivot #4', '', '47', 'New tool', 'Frozen. Posted on ice', '', [
    ['1', 'a', '90', ''], ['1', 'b', '', ''], ['1', 'c', '', ''],
    ['3', 'a', '88', ''], ['3', 'b', '', ''], ['3', 'c', '', ''],
    ['6', 'a', '90', ''], ['6', 'b', '', ''], ['6', 'c', '', ''],
    ['7', 'a', '90', ''], ['7', 'b', '', ''], ['7', 'c', '', ''],
  ]));

  // ── 24. 05/04/2026 — S4 — Pivot #3 — Height 34cm ──
  rows.push(...probeRows('05/04/2026', 'S4', 'Pivot #3', '', '34', 'New tool', 'Frozen. Posted on ice', '', [
    ['1', 'a', '96', ''], ['1', 'b', '', ''], ['1', 'c', '', ''],
    ['3', 'a', '90', ''], ['3', 'b', '', ''], ['3', 'c', '', ''],
    ['6', 'a', '90', ''], ['6', 'b', '', ''], ['6', 'c', '', ''],
    ['7', 'a', '88', ''], ['7', 'b', '', ''], ['7', 'c', '', ''],
  ]));

  // ── 25. 05/04/2026 — S7 — Pivot #2 — Height 27cm ──
  rows.push(...probeRows('05/04/2026', 'S7', 'Pivot #2', '', '27', 'New tool', 'Frozen. Posted on ice', '', [
    ['1', 'a', '92', ''], ['1', 'b', '', ''], ['1', 'c', '', ''],
    ['3', 'a', '90', ''], ['3', 'b', '', ''], ['3', 'c', '', ''],
    ['6', 'a', '86', ''], ['6', 'b', '', ''], ['6', 'c', '', ''],
    ['7', 'a', '88', ''], ['7', 'b', '', ''], ['7', 'c', '', ''],
  ]));

  // ── 26. 05/04/2026 — S5 — Pivot #1 — Height 44cm ──
  rows.push(...probeRows('05/04/2026', 'S5', 'Pivot #1', '', '44', 'New tool', 'Frozen. Posted on ice', '', [
    ['1', 'a', '90', ''], ['1', 'b', '', ''], ['1', 'c', '', ''],
    ['3', 'a', '88', ''], ['3', 'b', '', ''], ['3', 'c', '', ''],
    ['6', 'a', '88', ''], ['6', 'b', '', ''], ['6', 'c', '', ''],
    ['7', 'a', '86', ''], ['7', 'b', '', ''], ['7', 'c', '', ''],
  ]));

  // ── 27. 24/02/2026 — S2 — Carbon Cube Cycle 1 — no temps ──
  rows.push(...probeRows('24/02/2026', 'S2', 'Carbon Cube Cycle 1', '', '', 'New tool', 'Frozen. Posted on ice', '', [
    ['1', 'a', '', ''], ['1', 'b', '', ''], ['1', 'c', '', ''],
    ['3', 'a', '', ''], ['3', 'b', '', ''], ['3', 'c', '', ''],
    ['6', 'a', '', ''], ['6', 'b', '', ''], ['6', 'c', '', ''],
    ['7', 'a', '', ''], ['7', 'b', '', ''], ['7', 'c', '', ''],
  ]));

  // ── 28. 24/02/2026 — S2 — Carbon Cube Cycle 2 — no temps ──
  rows.push(...probeRows('24/02/2026', 'S2', 'Carbon Cube Cycle 2', '', '', 'New tool', 'Frozen. Posted on ice', '', [
    ['1', 'a', '', ''], ['1', 'b', '', ''], ['1', 'c', '', ''],
    ['3', 'a', '', ''], ['3', 'b', '', ''], ['3', 'c', '', ''],
    ['6', 'a', '', ''], ['6', 'b', '', ''], ['6', 'c', '', ''],
    ['7', 'a', '', ''], ['7', 'b', '', ''], ['7', 'c', '', ''],
  ]));

  // ── 29. 24/03/2026 — S3 — Carbon Cube Cycle 1 — Turn ──
  rows.push(...probeRows('24/03/2026', 'S3', 'Carbon Cube Cycle 1', 'Turn', '', 'New tool', 'Frozen. Posted on ice', '', [
    ['1', 'a', '', ''], ['1', 'b', '', ''], ['1', 'c', '', ''],
    ['3', 'a', '', ''], ['3', 'b', '', ''], ['3', 'c', '', ''],
    ['6', 'a', '', ''], ['6', 'b', '', ''], ['6', 'c', '', ''],
    ['7', 'a', '', ''], ['7', 'b', '', ''], ['7', 'c', '', ''],
  ]));

  // ── 30. 24/03/2026 — S3 — Carbon Cube Cycle 2 — Turn ──
  rows.push(...probeRows('24/03/2026', 'S3', 'Carbon Cube Cycle 2', 'Turn', '', 'New tool', 'Frozen. Posted on ice', '', [
    ['1', 'a', '', ''], ['1', 'b', '', ''], ['1', 'c', '', ''],
    ['3', 'a', '', ''], ['3', 'b', '', ''], ['3', 'c', '', ''],
    ['6', 'a', '', ''], ['6', 'b', '', ''], ['6', 'c', '', ''],
    ['7', 'a', '', ''], ['7', 'b', '', ''], ['7', 'c', '', ''],
  ]));

  // ── 31. 26/02/2026 — S1 — Carbon Cube Cycle 3 — Built ──
  rows.push(['26/02/2026', 'S1', 'Carbon Cube Cycle 3', '', '', '', '', '', '', 'New tool', 'Frozen. Posted on ice', 'Initial build — layered samples']);

  // ── 32. 24/03/2026 — S2 — Carbon Cube Cycle 3 — Turn ──
  rows.push(['24/03/2026', 'S2', 'Carbon Cube Cycle 3', 'Turn', '', '', '', '', '', 'New tool', 'Frozen. Posted on ice', 'Layered samples']);

  return rows;
}

export default async (req: Request, _context: Context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
  }

  try {
    const sheets = getGoogleSheetsClient();

    // Check if tab already exists
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const existing = meta.data.sheets?.find(s => s.properties?.title === TAB_NAME);

    if (existing) {
      return new Response(JSON.stringify({ error: `Tab "${TAB_NAME}" already exists. Delete it first if you want to recreate.` }), { status: 409 });
    }

    // Create the tab
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: TAB_NAME } } }],
      },
    });

    // Build full data: headers + all rows
    const allData = [HEADERS, ...getAllRows()];

    // Write all data at once
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${TAB_NAME}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: allData },
    });

    // Bold + freeze the header row
    const newMeta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const newSheet = newMeta.data.sheets?.find(s => s.properties?.title === TAB_NAME);
    const sheetId = newSheet?.properties?.sheetId;

    if (sheetId !== undefined) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              repeatCell: {
                range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                cell: {
                  userEnteredFormat: {
                    textFormat: { bold: true },
                    backgroundColor: { red: 0.85, green: 0.92, blue: 0.83 },
                  },
                },
                fields: 'userEnteredFormat(textFormat,backgroundColor)',
              },
            },
            {
              updateSheetProperties: {
                properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                fields: 'gridProperties.frozenRowCount',
              },
            },
          ],
        },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      tab: TAB_NAME,
      rows: allData.length - 1,
      message: `Created "${TAB_NAME}" with ${allData.length - 1} data rows`,
    }));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
};

export const config = { path: '/api/sampling-log-setup' };

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

// Map system IDs to their sheet tab names
const SYSTEM_TAB_MAP: Record<string, string> = {
  'pivot-1': 'Pivot #1',
  'pivot-2': 'Pivot #2',
  'pivot-3': 'Pivot #3',
  'pivot-4': 'Pivot #4',
  'carbon-cube-1': 'Carbon Cube Cycle 1 ',
  'cylinder-1': 'Cylinder #1',
  'cylinder-2': 'Cylinder #2',
  'cylinder-3': 'Cylinder #3',
  'batch-1': 'Batch 1',
  'batch-2': 'Batch 2',
  'batch-3': 'Batch 3',
};

// Number of probes per system
const SYSTEM_PROBE_COUNT: Record<string, number> = {
  'carbon-cube-1': 3,
  'cylinder-1': 5,
  'cylinder-2': 5,
  'cylinder-3': 5,
};

function getProbeCount(systemId: string): number {
  return SYSTEM_PROBE_COUNT[systemId] || 9;
}

// Convert 0-based column index to sheet column letter (A=0, B=1, ..., Z=25, AA=26, ...)
function colLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

async function ensureSheetTab(sheets: ReturnType<typeof getGoogleSheetsClient>, spreadsheetId: string, tabName: string, probeCount: number): Promise<void> {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = spreadsheet.data.sheets?.some((s: any) => s.properties?.title === tabName);
  if (exists) return;

  // Create the tab
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
  });

  // Write headers
  const probeHeaders = Array.from({ length: probeCount }, (_, i) => `Probe ${i + 1}`);
  const headers = ['Date', 'Time', 'Weather', 'Amb Min', 'Amb Max', 'Moisture', 'Odour', ...probeHeaders, 'Average', 'Peak', 'Vent Temps', 'Visual Notes', 'General Notes', 'Media Links'];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [headers] },
  });
}

interface WriteRequest {
  tab: string;
  probeCount?: number;  // optional override — used for custom systems with non-9 probes
  date: string;
  time: string;
  weather: string | null;
  ambientMin: number | null;
  ambientMax: number | null;
  moisture: string | null;
  odour: string | null;
  probes: (number | null)[];
  ventTemps: string;
  visualNotes: string;
  generalNotes: string;
  mediaLinks: string[];  // Drive webViewLink URLs (empty if no photos)
  height?: number | null; // pile height in cm
  turn?: boolean;         // whether this entry marks a turn
  newWidth?: number | null;  // new bay width in cm (after turn)
  newLength?: number | null; // new bay length in cm (after turn)
  /** Observation intensities keyed by header name — e.g. { "Fruit Flies": 2, "Mushrooms": 3 } */
  observations?: Record<string, number>;
}

const OBSERVATION_HEADERS = [
  'Fruit Flies', 'Flies', 'Mites', 'Birds', 'Rats',
  'Inky Caps', 'Mushrooms', 'Fungus', 'Seedlings',
];

export default async (request: Request, _context: Context) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
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

    const body: WriteRequest = await request.json();
    const sheetTab = SYSTEM_TAB_MAP[body.tab] || body.tab;

    // Build minimal row — just the fixed-position leading columns (Date..Probes + 2 formula slots).
    // Vent/Visual/General/Media are written by header name afterwards so they land in the correct
    // column on every sheet variant (some Pivot sheets have non-standard header ordering).
    const probeValues = body.probes.map(v => v !== null ? v : '');
    const row = [
      body.date,
      body.time,
      body.weather || '',
      body.ambientMin !== null ? body.ambientMin : '',
      body.ambientMax !== null ? body.ambientMax : '',
      body.moisture || '',
      body.odour || '',
      ...probeValues,
      '', '', // Average, Peak — formulas added below
    ];

    const sheets = getGoogleSheetsClient();

    // probeCount: use explicit override (for custom systems) or fall back to lookup
    const resolvedProbeCount = body.probeCount || getProbeCount(body.tab);

    // Create tab with headers if it doesn't exist yet
    await ensureSheetTab(sheets, spreadsheetId, sheetTab, resolvedProbeCount);

    // Append the row
    const appendResult = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${sheetTab}'!A:A`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [row],
      },
    });

    // Get the row number that was written to, then update formulas
    const updatedRange = appendResult.data.updates?.updatedRange;
    if (updatedRange) {
      // Extract row number from range like "'Pivot #1'!A5:T5"
      const match = updatedRange.match(/!.*?(\d+)/);
      if (match) {
        const rowNum = match[1];
        const probeCount = resolvedProbeCount;
        // Row layout: Date(A), Time(B), Weather(C), AmbMin(D), AmbMax(E), Moisture(F), Odour(G), Probes(H...)
        // First probe col = H (index 7), last probe col = H + probeCount - 1
        const firstProbeCol = colLetter(7); // H
        const lastProbeCol = colLetter(7 + probeCount - 1);
        const avgCol = colLetter(7 + probeCount);
        const peakCol = colLetter(7 + probeCount + 1);

        const avgFormula = `=IF(COUNTA(${firstProbeCol}${rowNum}:${lastProbeCol}${rowNum})>0,AVERAGE(${firstProbeCol}${rowNum}:${lastProbeCol}${rowNum}),"")`;
        const peakFormula = `=IF(COUNTA(${firstProbeCol}${rowNum}:${lastProbeCol}${rowNum})>0,MAX(${firstProbeCol}${rowNum}:${lastProbeCol}${rowNum}),"")`;

        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${sheetTab}'!${avgCol}${rowNum}:${peakCol}${rowNum}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: {
            values: [[avgFormula, peakFormula]],
          },
        });

        // Always scan headers so vent/visual/general/media land in the right columns
        // for each sheet variant.
        const headerRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${sheetTab}'!A1:AZ5`,
        });
        const headerRows = headerRes.data.values || [];

        // Pick the header row (first row with ≥2 known header keywords)
        const HEADER_KEYWORDS = ['date', 'time', 'weather', 'averag', 'peak', 'height', 'moisture', 'probe', 'odour', 'ambient'];
        let pickedHeader: string[] = [];
        for (const hr of headerRows) {
          const lowered = (hr || []).map((c: string) => (c || '').toLowerCase().trim());
          const matches = lowered.filter(c => HEADER_KEYWORDS.some(k => c.includes(k))).length;
          if (matches >= 2) { pickedHeader = hr || []; break; }
        }
        const hLower = pickedHeader.map((c: string) => (c || '').toLowerCase().trim());

        const findColByTerms = (...terms: string[]): number =>
          hLower.findIndex(c => terms.some(t => c.includes(t)));

        const writeCell = async (colIdx: number, value: string | number) => {
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'${sheetTab}'!${colLetter(colIdx)}${rowNum}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[value]] },
          });
        };

        // Vent temps
        const ventIdx = findColByTerms('vent');
        if (ventIdx >= 0 && body.ventTemps) await writeCell(ventIdx, body.ventTemps);

        // Visual / General notes — use header names; if the sheet has only a single
        // "Notes" column, merge visual+general into it.
        const visualIdx = findColByTerms('visual');
        const generalIdx = hLower.findIndex((c, i) => i !== visualIdx && c.includes('general'));
        const singleNotesIdx = visualIdx < 0 && generalIdx < 0
          ? hLower.findIndex(c => c.includes('note'))
          : -1;

        if (visualIdx >= 0 && body.visualNotes) await writeCell(visualIdx, body.visualNotes);
        if (generalIdx >= 0 && body.generalNotes) {
          await writeCell(generalIdx, body.generalNotes);
        } else if (visualIdx >= 0 && body.generalNotes) {
          // No general col but we do have visual — fall back: find any other "note" col
          const altNoteIdx = hLower.findIndex((c, i) => i !== visualIdx && c.includes('note'));
          if (altNoteIdx >= 0) await writeCell(altNoteIdx, body.generalNotes);
        }
        if (singleNotesIdx >= 0) {
          const combined = [body.visualNotes, body.generalNotes].filter(Boolean).join('\n');
          if (combined) await writeCell(singleNotesIdx, combined);
        }

        // Media links
        const mediaIdx = findColByTerms('media');
        if (mediaIdx >= 0 && body.mediaLinks.length > 0) {
          await writeCell(mediaIdx, body.mediaLinks.join('\n'));
        }

        // Observations — auto-extend the header row with any observation
        // columns that aren't present yet, then write the intensity value.
        // Stored as an integer (0..4). We only write non-zero values so the
        // spreadsheet stays visually clean.
        if (body.observations && Object.keys(body.observations).length > 0) {
          const presentLower = new Set(hLower);
          const missing = OBSERVATION_HEADERS.filter(h => !presentLower.has(h.toLowerCase()));
          let effectiveHeader = pickedHeader;
          if (missing.length > 0) {
            // Append missing headers to the END of the header row
            const startIdx = effectiveHeader.length;
            const endIdx = startIdx + missing.length - 1;
            await sheets.spreadsheets.values.update({
              spreadsheetId,
              range: `'${sheetTab}'!${colLetter(startIdx)}1:${colLetter(endIdx)}1`,
              valueInputOption: 'RAW',
              requestBody: { values: [missing] },
            });
            effectiveHeader = [...effectiveHeader, ...missing];
          }
          const effLower = effectiveHeader.map((c: string) => (c || '').toLowerCase().trim());
          for (const [headerName, intensity] of Object.entries(body.observations)) {
            if (!intensity || intensity < 1) continue;
            const idx = effLower.indexOf(headerName.toLowerCase());
            if (idx >= 0) {
              await writeCell(idx, intensity);
            }
          }
        }

        const needsHeaderScan = body.height != null || body.turn || body.newWidth != null || body.newLength != null;
        if (needsHeaderScan) {
          const findCol = (keyword: string): number => {
            for (const hRow of headerRows) {
              const idx = (hRow || []).findIndex((c: string) => (c || '').toLowerCase().trim().includes(keyword));
              if (idx >= 0) return idx;
            }
            return -1;
          };

          // Write height
          if (body.height != null) {
            const heightColIdx = findCol('height');
            if (heightColIdx >= 0) {
              await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `'${sheetTab}'!${colLetter(heightColIdx)}${rowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[body.height]] },
              });
            }
          }

          // Write Turn marker
          if (body.turn) {
            const turnColIdx = findCol('turn');
            if (turnColIdx >= 0) {
              await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `'${sheetTab}'!${colLetter(turnColIdx)}${rowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [['Yes']] },
              });
            }
          }

          // Write new width
          if (body.newWidth != null) {
            const widthColIdx = findCol('width');
            if (widthColIdx >= 0) {
              await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `'${sheetTab}'!${colLetter(widthColIdx)}${rowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[body.newWidth]] },
              });
            }
          }

          // Write new length
          if (body.newLength != null) {
            let lengthColIdx = findCol('length');
            if (lengthColIdx < 0) lengthColIdx = findCol('lenth'); // handle typo in some sheets
            if (lengthColIdx >= 0) {
              await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `'${sheetTab}'!${colLetter(lengthColIdx)}${rowNum}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [[body.newLength]] },
              });
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: `Row appended to ${sheetTab}`,
      updatedRange,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error writing to sheet:', error);
    return new Response(JSON.stringify({
      error: 'Failed to write to sheet',
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

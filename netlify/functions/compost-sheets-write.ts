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

interface TabInfo {
  sheetId: number | null;
  /** Current grid width — needed because values writes can't extend the
   * grid; new columns (EntryId, observations) require an explicit
   * appendDimension first. */
  columnCount: number;
}

async function ensureSheetTab(sheets: ReturnType<typeof getGoogleSheetsClient>, spreadsheetId: string, tabName: string, probeCount: number): Promise<TabInfo> {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = spreadsheet.data.sheets?.find((s: any) => s.properties?.title === tabName);
  if (existing) {
    return {
      sheetId: existing.properties?.sheetId ?? null,
      columnCount: existing.properties?.gridProperties?.columnCount ?? 26,
    };
  }

  // Create the tab
  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
  });
  const sheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId ?? null;
  const columnCount = addRes.data.replies?.[0]?.addSheet?.properties?.gridProperties?.columnCount ?? 26;

  // Write headers
  const probeHeaders = Array.from({ length: probeCount }, (_, i) => `Probe ${i + 1}`);
  const headers = ['Date', 'Time', 'Weather', 'Amb Min', 'Amb Max', 'Moisture', 'Odour', ...probeHeaders, 'Average', 'Peak', 'Vent Temps', 'Visual Notes', 'General Notes', 'Media Links'];
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [headers] },
  });
  return { sheetId, columnCount };
}

interface WriteRequest {
  /** Client-generated entry id. When provided, an existing row with the same
   * EntryId is updated in place — making retries and "update today's
   * reading" idempotent instead of appending duplicate rows. */
  entryId?: string;
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
  /** One-off extra readings (probe mini-map). Included in the row's
   * Average/Peak formulas as literals and recorded in an "Extra Readings"
   * column — they never occupy the standard probe columns. */
  extraReadings?: { label: string; value: number }[];
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
  'Ink Caps', 'Mushrooms', 'Fungus', 'Seedlings',
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

    const sheets = getGoogleSheetsClient();

    // probeCount: use explicit override (for custom systems) or fall back to lookup
    const resolvedProbeCount = body.probeCount || getProbeCount(body.tab);

    // Create tab with headers if it doesn't exist yet
    const tabInfo = await ensureSheetTab(sheets, spreadsheetId, sheetTab, resolvedProbeCount);

    // --- Header scan (up front, so named-column writes and the EntryId
    // upsert lookup can both use it) -----------------------------------
    const headerRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${sheetTab}'!A1:AZ5`,
    });
    const headerRows = headerRes.data.values || [];

    // Pick the header row (first row with ≥2 known header keywords)
    const HEADER_KEYWORDS = ['date', 'time', 'weather', 'averag', 'peak', 'height', 'moisture', 'probe', 'odour', 'ambient'];
    let pickedHeader: string[] = [];
    let headerRowNum = 1; // 1-based sheet row the header lives on
    for (let i = 0; i < headerRows.length; i++) {
      const lowered = (headerRows[i] || []).map((c: string) => (c || '').toLowerCase().trim());
      const matches = lowered.filter(c => HEADER_KEYWORDS.some(k => c.includes(k))).length;
      if (matches >= 2) { pickedHeader = headerRows[i] || []; headerRowNum = i + 1; break; }
    }
    const headerUsable = pickedHeader.length >= 2;

    // Headers we may need to add (missing observation columns, EntryId).
    // Collected here and written together with the data cells below.
    const effectiveHeader = [...pickedHeader];
    const headerAppends: string[] = [];
    const ensureHeaderCol = (name: string): number => {
      const lower = effectiveHeader.map((c: string) => (c || '').toLowerCase().trim());
      const target = name.toLowerCase();
      const idx = lower.indexOf(target);
      if (idx >= 0) return idx;
      effectiveHeader.push(name);
      headerAppends.push(name);
      return effectiveHeader.length - 1;
    };

    const hasObservations = !!(body.observations && Object.keys(body.observations).length > 0);
    if (hasObservations && headerUsable) {
      for (const h of OBSERVATION_HEADERS) ensureHeaderCol(h);
    }

    const extras = (body.extraReadings || []).filter(e => typeof e.value === 'number' && isFinite(e.value));
    let extraColIdx = -1;
    if (headerUsable) {
      // Locate (or, when extras exist, create) the Extra Readings column
      const existingExtraIdx = effectiveHeader.findIndex(
        (c: string) => (c || '').toLowerCase().trim().includes('extra reading'));
      if (existingExtraIdx >= 0) extraColIdx = existingExtraIdx;
      else if (extras.length > 0) extraColIdx = ensureHeaderCol('Extra Readings');
    }

    // --- EntryId upsert lookup ----------------------------------------
    // Find the EntryId column; if the entry was written before, we update
    // that row instead of appending a duplicate.
    let entryIdColIdx: number | null = null;
    let existingRowNum: number | null = null;
    if (body.entryId && headerUsable) {
      const lowerNoSpace = pickedHeader.map((c: string) => (c || '').toLowerCase().replace(/\s+/g, ''));
      const found = lowerNoSpace.indexOf('entryid');
      if (found >= 0) {
        entryIdColIdx = found;
        const colRes = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${sheetTab}'!${colLetter(found)}:${colLetter(found)}`,
        });
        const colVals = colRes.data.values || [];
        for (let i = colVals.length - 1; i >= 0; i--) {
          if (((colVals[i]?.[0] as string) || '').trim() === body.entryId) {
            existingRowNum = i + 1;
            break;
          }
        }
      } else {
        // Column doesn't exist yet — add it; nothing to look up.
        entryIdColIdx = ensureHeaderCol('EntryId');
      }
    }
    const isUpdate = existingRowNum !== null;

    // --- Resolve the sheet's REAL probe / Average / Peak layout --------
    // A build's probe count can be reduced in the app after its tab was
    // created with a wider header (e.g. CC4: header has Probe 1-9 with
    // Average in col Q, but the build now uses 3 probes). Formulas must
    // land in the sheet's actual Average/Peak columns — computing them as
    // 7 + requestProbeCount put formulas inside the Probe 4/5 columns and
    // left the real Average blank, so charts cut off at that date.
    const hLowerAll = effectiveHeader.map((c: string) => (c || '').toLowerCase().trim());
    const headerAvgIdx = hLowerAll.findIndex(c => c.includes('averag'));
    const headerPeakIdx = hLowerAll.findIndex(c => c.includes('peak'));
    const useHeaderLayout = headerAvgIdx > 7 && body.probes.length <= headerAvgIdx - 7;
    const sheetProbeCount = useHeaderLayout ? headerAvgIdx - 7 : Math.max(body.probes.length, 1);
    const avgColIdx = useHeaderLayout ? headerAvgIdx : 7 + sheetProbeCount;
    const peakColIdx = useHeaderLayout && headerPeakIdx > headerAvgIdx ? headerPeakIdx : avgColIdx + 1;

    // --- Write the main row (update in place, or append) ---------------
    // Probes are padded to the sheet's probe-column count so the two
    // trailing placeholders always line up with the Average/Peak columns.
    const probeValues: (number | string)[] = body.probes.map(v => v !== null ? v : '');
    while (probeValues.length < sheetProbeCount) probeValues.push('');
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

    let rowNum: number | null = null;
    let updatedRange: string | undefined;
    if (existingRowNum !== null) {
      rowNum = existingRowNum;
      updatedRange = `'${sheetTab}'!A${rowNum}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: updatedRange,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      });
    } else {
      const appendResult = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${sheetTab}'!A:A`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] },
      });
      updatedRange = appendResult.data.updates?.updatedRange ?? undefined;
      // Extract row number from range like "'Pivot #1'!A5:T5"
      const match = updatedRange?.match(/!.*?(\d+)/);
      if (match) rowNum = parseInt(match[1], 10);
    }

    // --- Everything else lands in one batched write --------------------
    if (rowNum !== null) {
      const dataWrites: { range: string; values: (string | number)[][] }[] = [];
      const writeCell = (colIdx: number, value: string | number) => {
        dataWrites.push({
          range: `'${sheetTab}'!${colLetter(colIdx)}${rowNum}`,
          values: [[value]],
        });
      };

      // New header columns (observations / EntryId) appended at the end of
      // the header row. The grid must be widened first — values writes fail
      // with "exceeds grid limits" if the new columns are past the current
      // sheet width.
      if (headerAppends.length > 0) {
        if (tabInfo.sheetId !== null && effectiveHeader.length > tabInfo.columnCount) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [{
                appendDimension: {
                  sheetId: tabInfo.sheetId,
                  dimension: 'COLUMNS',
                  length: effectiveHeader.length - tabInfo.columnCount,
                },
              }],
            },
          });
        }
        const startIdx = effectiveHeader.length - headerAppends.length;
        dataWrites.push({
          range: `'${sheetTab}'!${colLetter(startIdx)}${headerRowNum}:${colLetter(effectiveHeader.length - 1)}${headerRowNum}`,
          values: [headerAppends],
        });
      }

      // Average / Peak formulas — written to the sheet's real Average/Peak
      // columns, spanning ALL probe columns in the header (blank ones are
      // ignored by AVERAGE/MAX). Extra one-off readings are embedded as
      // literals so they count toward the row's average and (importantly
      // for the kill cycle) its peak, without occupying probe columns.
      const firstProbeCol = colLetter(7); // H
      const lastProbeCol = colLetter(7 + sheetProbeCount - 1);
      const probeRange = `${firstProbeCol}${rowNum}:${lastProbeCol}${rowNum}`;
      if (extras.length > 0) {
        const literals = extras.map(e => e.value).join(',');
        writeCell(avgColIdx, `=AVERAGE(${probeRange},${literals})`);
        writeCell(peakColIdx, `=MAX(${probeRange},${literals})`);
      } else {
        writeCell(avgColIdx, `=IF(COUNTA(${probeRange})>0,AVERAGE(${probeRange}),"")`);
        writeCell(peakColIdx, `=IF(COUNTA(${probeRange})>0,MAX(${probeRange}),"")`);
      }

      const hLower = effectiveHeader.map((c: string) => (c || '').toLowerCase().trim());
      const findColByTerms = (...terms: string[]): number =>
        hLower.findIndex(c => terms.some(t => c.includes(t)));

      // Vent temps / notes / media — written by header name so they land in
      // the right column on every sheet variant. When updating an existing
      // row we also write empty values, so cleared fields actually clear.
      const ventIdx = findColByTerms('vent');
      if (ventIdx >= 0 && (body.ventTemps || isUpdate)) writeCell(ventIdx, body.ventTemps || '');

      const visualIdx = findColByTerms('visual');
      const generalIdx = hLower.findIndex((c, i) => i !== visualIdx && c.includes('general'));
      const singleNotesIdx = visualIdx < 0 && generalIdx < 0
        ? hLower.findIndex(c => c.includes('note'))
        : -1;

      if (visualIdx >= 0 && (body.visualNotes || isUpdate)) writeCell(visualIdx, body.visualNotes || '');
      if (generalIdx >= 0 && (body.generalNotes || isUpdate)) {
        writeCell(generalIdx, body.generalNotes || '');
      } else if (generalIdx < 0 && visualIdx >= 0 && body.generalNotes) {
        // No general col but we do have visual — fall back: find any other "note" col
        const altNoteIdx = hLower.findIndex((c, i) => i !== visualIdx && c.includes('note'));
        if (altNoteIdx >= 0) writeCell(altNoteIdx, body.generalNotes);
      }
      if (singleNotesIdx >= 0) {
        const combined = [body.visualNotes, body.generalNotes].filter(Boolean).join('\n');
        if (combined || isUpdate) writeCell(singleNotesIdx, combined);
      }

      // Media links
      const mediaIdx = findColByTerms('media');
      if (mediaIdx >= 0 && (body.mediaLinks.length > 0 || isUpdate)) {
        writeCell(mediaIdx, body.mediaLinks.join('\n'));
      }

      // Observations — stored as an integer (0..4). Non-zero values are
      // written; on update, zeros clear the cell so removed observations
      // don't linger from the previous version of the row.
      if (hasObservations) {
        for (const [headerName, intensity] of Object.entries(body.observations!)) {
          const idx = hLower.indexOf(headerName.toLowerCase());
          if (idx < 0) continue;
          if (intensity && intensity >= 1) writeCell(idx, intensity);
          else if (isUpdate) writeCell(idx, '');
        }
      }

      // Height / Turn / new dimensions — header scanned across all rows
      // (some sheets keep these on a second header row)
      const findCol = (keyword: string): number => {
        const idx = hLower.findIndex(c => c.includes(keyword));
        if (idx >= 0) return idx;
        for (const hRow of headerRows) {
          const i = (hRow || []).findIndex((c: string) => (c || '').toLowerCase().trim().includes(keyword));
          if (i >= 0) return i;
        }
        return -1;
      };

      if (body.height != null || isUpdate) {
        const heightColIdx = findCol('height');
        if (heightColIdx >= 0 && (body.height != null || isUpdate)) {
          writeCell(heightColIdx, body.height != null ? body.height : '');
        }
      }
      if (body.turn || isUpdate) {
        const turnColIdx = findCol('turn');
        if (turnColIdx >= 0) writeCell(turnColIdx, body.turn ? 'Yes' : '');
      }
      if (body.newWidth != null || isUpdate) {
        const widthColIdx = findCol('width');
        if (widthColIdx >= 0) writeCell(widthColIdx, body.newWidth != null ? body.newWidth : '');
      }
      if (body.newLength != null || isUpdate) {
        let lengthColIdx = findCol('length');
        if (lengthColIdx < 0) lengthColIdx = findCol('lenth'); // handle typo in some sheets
        if (lengthColIdx >= 0) writeCell(lengthColIdx, body.newLength != null ? body.newLength : '');
      }

      // Extra readings — recorded as "+2: 165, +6: 80" (°F, mini-map cell
      // numbers). Cleared on update when the entry no longer has extras.
      // The leading apostrophe forces text: USER_ENTERED would otherwise
      // treat the leading "+" as the start of a formula (#ERROR!).
      if (extraColIdx >= 0 && (extras.length > 0 || isUpdate)) {
        const text = extras.map(e => `${e.label}: ${e.value}`).join(', ');
        writeCell(extraColIdx, text ? `'${text}` : '');
      }

      // EntryId marker for future upserts
      if (body.entryId && entryIdColIdx !== null) {
        writeCell(entryIdColIdx, body.entryId);
      }

      if (dataWrites.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: {
            valueInputOption: 'USER_ENTERED',
            data: dataWrites,
          },
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: isUpdate ? `Row ${rowNum} updated in ${sheetTab}` : `Row appended to ${sheetTab}`,
      updated: isUpdate,
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

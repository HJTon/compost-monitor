/**
 * One-shot maintenance: de-duplicate the `Build Info` sheet tab.
 *
 * The tab accumulated duplicate rows for some builds (e.g. `Cylinder #2` in
 * two rows). The POST handler in `compost-build-info.ts` writes to the FIRST
 * matching row, so any value that ended up in a later duplicate is invisible
 * to the app. This merges each duplicate group down to one row without losing
 * data, and removes a few known junk rows left behind by tab-discovery and a
 * test.
 *
 * Idempotent — running it again on a clean tab does nothing.
 *
 * GET /.netlify/functions/compost-build-info-dedupe?dryRun=1  → report only, no writes
 * GET /.netlify/functions/compost-build-info-dedupe           → apply changes
 *
 * Merge rules:
 *  - Rows are grouped by the exact System name in column A (no trimming, so we
 *    never merge two rows that `compost-build-info.ts` would treat as different).
 *  - For every column, the merged value is the FIRST non-empty value scanning
 *    the group's rows in sheet order — so data survives whichever row it sits in.
 *  - Exception: `UpdatedAt` (column I) keeps the most recent parseable timestamp.
 *  - The merged row is written back over the FIRST row of the group; the other
 *    rows of the group are deleted.
 *
 * Junk rules:
 *  - A row is only removed as junk if its System name is in JUNK_SYSTEMS *and*
 *    every other column in that row is empty. A junk-named row carrying data is
 *    left alone (and still takes part in duplicate merging).
 *
 * `rowsDeleted` in the response is the grand total of rows removed
 * (duplicate rows + junk rows); `junkRowsRemoved` is the junk subset.
 */

import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

const TAB = 'Build Info';
const RANGE = `'${TAB}'!A:K`;
const COL_COUNT = 11; // A..K
const COL_UPDATED_AT = 8; // col I
const COL_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
const COL_NAMES = [
  'System', 'Notes', 'Summary', 'BuildType', 'MulchBins', 'MulchType',
  'Dimensions', 'ProbeLabels', 'UpdatedAt', 'BuildDate', 'Rating',
];
const UPDATED_AT_COL = 8; // column I

/** Rows with these System names are tab-discovery / test leftovers, not builds. */
const JUNK_SYSTEMS = ['Sampling Log', 'Build Info', 'Test Trial Build'];

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

function getSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

interface SheetRow {
  /** 0-based index into the values array — also the deleteDimension startIndex. */
  index: number;
  /** 1-based row number as shown in the spreadsheet UI. */
  sheetRow: number;
  /** Always COL_COUNT long; short rows are padded with ''. */
  cells: string[];
}

function isBlank(v: string | undefined): boolean {
  return !v || v.trim() === '';
}

function normaliseRow(raw: string[] | undefined, index: number): SheetRow {
  const cells: string[] = [];
  for (let c = 0; c < COL_COUNT; c++) cells.push(raw?.[c] ?? '');
  return { index, sheetRow: index + 1, cells };
}

/** True when every column except System (A) is empty. */
/**
 * True when the row holds nothing a user would miss. UpdatedAt (col I) is
 * excluded deliberately — it's a machine-written timestamp, so a row carrying
 * only that is still empty as far as the operator is concerned.
 */
function hasNoDataBesidesName(row: SheetRow): boolean {
  for (let c = 1; c < COL_COUNT; c++) {
    if (c === COL_UPDATED_AT) continue;
    if (!isBlank(row.cells[c])) return false;
  }
  return true;
}

function timestampValue(raw: string): number {
  if (isBlank(raw)) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(raw.trim());
  return isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

interface MergeResult {
  cells: string[];
  /** Human-readable notes about values pulled out of a non-first row. */
  rescued: string[];
}

/** First non-empty value per column, in sheet order; newest UpdatedAt wins. */
function mergeGroup(rows: SheetRow[]): MergeResult {
  const first = rows[0];
  const merged = [...first.cells];
  const rescued: string[] = [];

  for (let c = 0; c < COL_COUNT; c++) {
    if (c === UPDATED_AT_COL) continue;
    if (!isBlank(merged[c])) continue;
    for (let r = 1; r < rows.length; r++) {
      const candidate = rows[r].cells[c];
      if (!isBlank(candidate)) {
        merged[c] = candidate;
        rescued.push(`${COL_NAMES[c]} from row ${rows[r].sheetRow}`);
        break;
      }
    }
  }

  // UpdatedAt: keep the most recent timestamp anywhere in the group.
  let bestRow = first;
  let bestValue = timestampValue(first.cells[UPDATED_AT_COL]);
  for (let r = 1; r < rows.length; r++) {
    const v = timestampValue(rows[r].cells[UPDATED_AT_COL]);
    if (v > bestValue) {
      bestValue = v;
      bestRow = rows[r];
    }
  }
  if (bestRow !== first) {
    merged[UPDATED_AT_COL] = bestRow.cells[UPDATED_AT_COL];
    rescued.push(`UpdatedAt from row ${bestRow.sheetRow} (most recent)`);
  } else if (isBlank(merged[UPDATED_AT_COL])) {
    // Nothing parseable anywhere — fall back to any non-empty value in order.
    for (let r = 1; r < rows.length; r++) {
      if (!isBlank(rows[r].cells[UPDATED_AT_COL])) {
        merged[UPDATED_AT_COL] = rows[r].cells[UPDATED_AT_COL];
        rescued.push(`UpdatedAt from row ${rows[r].sheetRow}`);
        break;
      }
    }
  }

  return { cells: merged, rescued };
}

function sameCells(a: string[], b: string[]): boolean {
  for (let c = 0; c < COL_COUNT; c++) {
    if ((a[c] ?? '') !== (b[c] ?? '')) return false;
  }
  return true;
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

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: JSON_HEADERS,
    });
  }

  try {
    const spreadsheetId = process.env.COMPOST_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return new Response(JSON.stringify({ error: 'Spreadsheet ID not configured' }), {
        status: 500, headers: JSON_HEADERS,
      });
    }

    const url = new URL(request.url);
    const dryRunParam = url.searchParams.get('dryRun');
    const dryRun = dryRunParam !== null && dryRunParam !== '0' && dryRunParam !== 'false';

    const sheets = getSheetsClient();

    // Numeric sheetId is required by deleteDimension.
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const tabMeta = meta.data.sheets?.find(s => s.properties?.title === TAB);
    const sheetId = tabMeta?.properties?.sheetId;
    if (sheetId == null) {
      return new Response(JSON.stringify({ error: `Tab '${TAB}' not found` }), {
        status: 404, headers: JSON_HEADERS,
      });
    }

    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
    const values = (res.data.values as string[][]) || [];

    if (values.length < 2) {
      return new Response(JSON.stringify({
        success: true, dryRun, duplicatesMerged: 0, rowsDeleted: 0, junkRowsRemoved: 0,
        details: ['Nothing to do — tab has no data rows.'],
      }), { status: 200, headers: JSON_HEADERS });
    }

    // Safety: refuse to touch anything unless row 1 really is the header row,
    // otherwise every index below would be off by one against real data.
    const headerCell = (values[0]?.[0] ?? '').trim().toLowerCase();
    if (headerCell !== 'system') {
      return new Response(JSON.stringify({
        error: 'Unexpected header row — aborting without changes',
        details: `Expected A1 to be "System", found "${values[0]?.[0] ?? ''}"`,
      }), { status: 409, headers: JSON_HEADERS });
    }

    // Data rows only: array index 1..n-1 → sheet rows 2..n.
    const dataRows: SheetRow[] = [];
    for (let i = 1; i < values.length; i++) {
      dataRows.push(normaliseRow(values[i], i));
    }

    const details: string[] = [];
    const rowsToDelete: number[] = []; // 0-based array indices
    let junkRowsRemoved = 0;

    // Pass 1 — junk rows (named in JUNK_SYSTEMS and carrying no other data).
    const survivors: SheetRow[] = [];
    for (const row of dataRows) {
      const name = row.cells[0];
      if (isBlank(name)) {
        // Entirely blank / nameless row — not ours to judge, leave it.
        continue;
      }
      if (JUNK_SYSTEMS.includes(name.trim())) {
        if (hasNoDataBesidesName(row)) {
          rowsToDelete.push(row.index);
          junkRowsRemoved++;
          details.push(`Junk row ${row.sheetRow} ("${name}") — empty apart from the name, deleting.`);
          continue;
        }
        details.push(`Row ${row.sheetRow} ("${name}") matches a junk name but carries data — keeping.`);
      }
      survivors.push(row);
    }

    // Pass 2 — group the remaining rows by exact System name.
    const groups = new Map<string, SheetRow[]>();
    for (const row of survivors) {
      const key = row.cells[0];
      const existing = groups.get(key);
      if (existing) existing.push(row);
      else groups.set(key, [row]);
    }

    const valueUpdates: Array<{ range: string; values: string[][] }> = [];
    let duplicatesMerged = 0;

    for (const [name, rows] of groups) {
      if (rows.length < 2) continue;
      duplicatesMerged++;
      const target = rows[0];
      const { cells, rescued } = mergeGroup(rows);
      const dupRows = rows.slice(1);

      for (const dup of dupRows) rowsToDelete.push(dup.index);

      const changed = !sameCells(cells, target.cells);
      if (changed) {
        valueUpdates.push({
          range: `'${TAB}'!${COL_LETTERS[0]}${target.sheetRow}:${COL_LETTERS[COL_COUNT - 1]}${target.sheetRow}`,
          values: [cells],
        });
      }

      details.push(
        `"${name}": ${rows.length} rows (${rows.map(r => r.sheetRow).join(', ')}) → merged into row ${target.sheetRow}`
        + (rescued.length > 0 ? `; recovered ${rescued.join(', ')}` : '; row ' + target.sheetRow + ' already held every value')
        + `; deleting row${dupRows.length > 1 ? 's' : ''} ${dupRows.map(r => r.sheetRow).join(', ')}.`,
      );
    }

    if (details.length === 0) {
      details.push('Nothing to do — no duplicates and no junk rows found.');
    }

    if (!dryRun) {
      // Write merged values FIRST, while the original row positions still hold.
      if (valueUpdates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId,
          requestBody: { valueInputOption: 'USER_ENTERED', data: valueUpdates },
        });
      }

      // Then delete. CRITICAL: descending order — deleting a row shifts every
      // row below it up by one, so lower indices must go last.
      if (rowsToDelete.length > 0) {
        const ordered = [...new Set(rowsToDelete)].sort((a, b) => b - a);
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: ordered.map(idx => ({
              deleteDimension: {
                range: {
                  sheetId,
                  dimension: 'ROWS' as const,
                  startIndex: idx,
                  endIndex: idx + 1,
                },
              },
            })),
          },
        });
      }
    } else {
      details.unshift('DRY RUN — nothing was written. Re-run without ?dryRun=1 to apply.');
    }

    return new Response(JSON.stringify({
      success: true,
      dryRun,
      duplicatesMerged,
      rowsDeleted: new Set(rowsToDelete).size,
      junkRowsRemoved,
      details,
    }), { status: 200, headers: JSON_HEADERS });
  } catch (error) {
    console.error('Error in build-info dedupe:', error);
    return new Response(JSON.stringify({
      error: 'Dedupe failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), { status: 500, headers: JSON_HEADERS });
  }
};

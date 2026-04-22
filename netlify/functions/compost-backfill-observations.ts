import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

// Scans every compost system tab's existing Visual Notes / General Notes
// columns for observation keywords (rats, inky caps ++, mushrooms+, etc.)
// and writes the parsed intensity into the matching observation column.
//
// Safe to re-run. By default it does NOT overwrite a row that already has
// a value in the observation column — pass { overwrite: true } to force.
//
// Usage: POST /.netlify/functions/compost-backfill-observations
//   Body: { dryRun?: boolean, overwrite?: boolean, tabs?: string[] }

const EXCLUDED_TABS = new Set([
  'bin tracker', 'system setup', 'score card', 'scorecard', 'template',
  'build info', 'build phases', 'sampling log', 'media',
]);

// Keep in sync with src/utils/observations.ts
interface ObsDef {
  key: string;
  sheetHeader: string;
  aliases: string[];
}
const OBSERVATIONS: ObsDef[] = [
  { key: 'fruitFlies', sheetHeader: 'Fruit Flies', aliases: ['fruit flies', 'fruit fly', 'fruitflies'] },
  { key: 'flies',      sheetHeader: 'Flies',       aliases: ['flies', 'fly'] },
  { key: 'mites',      sheetHeader: 'Mites',       aliases: ['mites', 'mite'] },
  { key: 'birds',      sheetHeader: 'Birds',       aliases: ['birds', 'bird'] },
  { key: 'rats',       sheetHeader: 'Rats',        aliases: ['rats', 'rat', 'rodent', 'rodents'] },
  { key: 'inkyCaps',   sheetHeader: 'Inky Caps',   aliases: ['inky caps', 'inky cap', 'inkycap', 'coprinus'] },
  { key: 'mushrooms',  sheetHeader: 'Mushrooms',   aliases: ['mushrooms', 'mushroom'] },
  { key: 'fungus',     sheetHeader: 'Fungus',      aliases: ['fungus', 'fungi', 'mycelium', 'hyphae'] },
  { key: 'seedlings',  sheetHeader: 'Seedlings',   aliases: ['seedlings', 'seedling', 'sprouts', 'sprouting'] },
];
const MAX_INTENSITY = 4;

function parseObservationsFromNotes(notes: string): Record<string, number> {
  if (!notes) return {};
  const lower = notes.toLowerCase();
  const out: Record<string, number> = {};
  for (const def of OBSERVATIONS) {
    let best = 0;
    for (const alias of def.aliases) {
      let idx = 0;
      while ((idx = lower.indexOf(alias, idx)) !== -1) {
        const before = idx > 0 ? lower[idx - 1] : ' ';
        const afterStart = idx + alias.length;
        const after = afterStart < lower.length ? lower[afterStart] : ' ';
        const isBoundary = (c: string) => !/[a-z]/.test(c);
        if (!isBoundary(before)) { idx = afterStart; continue; }
        if (!isBoundary(after) && after !== 's') { idx = afterStart; continue; }
        // Avoid "fruit flies" matching the "flies" alias
        if ((alias === 'flies' || alias === 'fly') && idx >= 6 && lower.slice(idx - 6, idx - 1) === 'fruit') {
          idx = afterStart; continue;
        }
        // Avoid "inky cap" / "mushroom" contexts matching bare "fungus" negations like "no fungi"
        if ((alias === 'fungus' || alias === 'fungi' || alias === 'mycelium' || alias === 'hyphae')) {
          const precedingWord = lower.slice(Math.max(0, idx - 4), idx).trim();
          if (precedingWord.endsWith('no') || precedingWord.endsWith('not')) { idx = afterStart; continue; }
        }
        let intensity = 1;
        let tail = afterStart + (after === 's' ? 1 : 0);
        while (tail < lower.length && lower[tail] === ' ') tail++;
        let plus = 0;
        while (tail < lower.length && lower[tail] === '+') { plus++; tail++; }
        if (plus > 0) intensity = Math.min(MAX_INTENSITY, 1 + plus);
        if (plus === 0 && tail < lower.length - 1 && lower[tail] === 'x') {
          const n = parseInt(lower[tail + 1], 10);
          if (!isNaN(n) && n >= 2 && n <= 4) intensity = n;
        }
        if (intensity > best) best = intensity;
        idx = afterStart;
      }
    }
    if (best > 0) out[def.key] = best;
  }
  return out;
}

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

function colLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

export default async (req: Request, _context: Context) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
  }

  try {
    const spreadsheetId = process.env.COMPOST_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return new Response(JSON.stringify({ error: 'Spreadsheet ID not configured' }), { status: 500 });
    }

    let body: { dryRun?: boolean; overwrite?: boolean; tabs?: string[] } = {};
    try { body = await req.json(); } catch { /* empty OK */ }
    const dryRun = body.dryRun === true;
    const overwrite = body.overwrite === true; // default false — preserve existing cell values

    const sheets = getGoogleSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetMetaByTitle = new Map<string, { sheetId: number; colCount: number }>();
    for (const s of meta.data.sheets || []) {
      const title = s.properties?.title;
      const id = s.properties?.sheetId;
      const cols = s.properties?.gridProperties?.columnCount || 26;
      if (title && id !== undefined && id !== null) sheetMetaByTitle.set(title, { sheetId: id, colCount: cols });
    }
    let tabs = (meta.data.sheets || [])
      .map(s => s.properties?.title as string)
      .filter(Boolean)
      .filter(t => !EXCLUDED_TABS.has(t.toLowerCase().trim()));
    if (body.tabs && body.tabs.length > 0) {
      const want = new Set(body.tabs.map(t => t.trim()));
      tabs = tabs.filter(t => want.has(t.trim()));
    }

    // Pull everything (cols A..AZ, up to 5000 rows) in one batch
    const ranges = tabs.map(t => `'${t}'!A1:AZ5000`);
    const batch = await sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges });
    const values = batch.data.valueRanges || [];

    interface Update { range: string; values: [[number]]; }
    const updates: Update[] = [];
    const perTabSummary: Array<{ tab: string; rowsScanned: number; hits: number }> = [];
    const samples: Array<{ tab: string; row: number; note: string; parsed: Record<string, number> }> = [];

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const rows = (values[i]?.values || []) as string[][];
      if (rows.length === 0) { perTabSummary.push({ tab, rowsScanned: 0, hits: 0 }); continue; }

      // Find header row — first row with any known text column we care about
      const HEADER_KEYWORDS = ['date', 'weather', 'probe', 'average', 'peak', 'moisture', 'odour', 'ambient'];
      let headerIdx = -1;
      for (let r = 0; r < Math.min(5, rows.length); r++) {
        const lowered = (rows[r] || []).map(c => (c || '').toLowerCase().trim());
        const matches = lowered.filter(c => HEADER_KEYWORDS.some(k => c.includes(k))).length;
        if (matches >= 2) { headerIdx = r; break; }
      }
      if (headerIdx < 0) { perTabSummary.push({ tab, rowsScanned: 0, hits: 0 }); continue; }
      const header = rows[headerIdx].map(c => (c || '').toLowerCase().trim());

      // Locate note columns
      const findCol = (...terms: string[]) => header.findIndex(c => terms.some(t => c.includes(t)));
      const visualCol = findCol('visual');
      const generalCol = findCol('general');
      const anyNoteCol = generalCol < 0 && visualCol < 0 ? findCol('note') : -1;

      // Ensure all observation headers exist — add missing ones at end
      let effectiveHeader = rows[headerIdx].slice();
      const lowerHdr = effectiveHeader.map(c => (c || '').toLowerCase().trim());
      const missing: string[] = [];
      for (const o of OBSERVATIONS) {
        if (!lowerHdr.includes(o.sheetHeader.toLowerCase())) missing.push(o.sheetHeader);
      }
      if (missing.length > 0 && !dryRun) {
        const startIdx = effectiveHeader.length;
        const endIdx = startIdx + missing.length - 1;
        // Expand grid if needed
        const sm = sheetMetaByTitle.get(tab);
        if (sm && endIdx + 1 > sm.colCount) {
          await sheets.spreadsheets.batchUpdate({
            spreadsheetId,
            requestBody: {
              requests: [{
                appendDimension: { sheetId: sm.sheetId, dimension: 'COLUMNS', length: (endIdx + 1) - sm.colCount },
              }],
            },
          });
          sm.colCount = endIdx + 1;
        }
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `'${tab}'!${colLetter(startIdx)}${headerIdx + 1}:${colLetter(endIdx)}${headerIdx + 1}`,
          valueInputOption: 'RAW',
          requestBody: { values: [missing] },
        });
        effectiveHeader = [...effectiveHeader, ...missing];
      } else if (missing.length > 0 && dryRun) {
        effectiveHeader = [...effectiveHeader, ...missing];
      }
      const effLower = effectiveHeader.map(c => (c || '').toLowerCase().trim());

      // Map observation key → column index
      const obsColByKey: Record<string, number> = {};
      for (const o of OBSERVATIONS) {
        const idx = effLower.indexOf(o.sheetHeader.toLowerCase());
        if (idx >= 0) obsColByKey[o.key] = idx;
      }

      let hits = 0;
      let rowsScanned = 0;
      for (let r = headerIdx + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const dateCell = row[0] || '';
        if (!dateCell.trim()) continue;
        rowsScanned++;
        const visual = visualCol >= 0 ? (row[visualCol] || '') : '';
        const general = generalCol >= 0 ? (row[generalCol] || '') : '';
        const anyNote = anyNoteCol >= 0 ? (row[anyNoteCol] || '') : '';
        const combined = [visual, general, anyNote].filter(Boolean).join(' ');
        if (!combined) continue;
        const parsed = parseObservationsFromNotes(combined);
        if (Object.keys(parsed).length === 0) continue;

        if (samples.length < 10) {
          samples.push({ tab, row: r + 1, note: combined.slice(0, 120), parsed });
        }

        for (const [key, intensity] of Object.entries(parsed)) {
          const col = obsColByKey[key];
          if (col === undefined) continue;
          const existing = (row[col] || '').trim();
          if (!overwrite && existing !== '') continue;
          updates.push({
            range: `'${tab}'!${colLetter(col)}${r + 1}`,
            values: [[intensity]],
          });
          hits++;
        }
      }
      perTabSummary.push({ tab, rowsScanned, hits });
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true, dryRun: true,
        tabsScanned: tabs.length,
        totalUpdates: updates.length,
        perTab: perTabSummary,
        sampleUpdates: updates.slice(0, 15),
        samples,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Execute writes in batches
    const CHUNK = 1000;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: chunk.map(u => ({ range: u.range, values: u.values })),
        },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      tabsScanned: tabs.length,
      wrote: updates.length,
      perTab: perTabSummary,
      samples,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('Backfill observations error:', err);
    return new Response(JSON.stringify({
      error: 'Failed to backfill observations',
      details: err instanceof Error ? err.message : String(err),
    }), { status: 500 });
  }
};

/**
 * One-shot backfill: for every row in the Media sheet tab that's missing an
 * EventDate or Tags value, fill them in from Drive's createdTime (EXIF) and
 * the slot → tag mapping. Safe to re-run.
 *
 * GET /.netlify/functions/compost-media-backfill            → backfill all rows
 * GET /.netlify/functions/compost-media-backfill?system=X   → only one system
 */

import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

const MEDIA_TAB = 'Media';
const RANGE = `'${MEDIA_TAB}'!A:M`;

const SLOT_DEFAULT_TAGS: Record<string, string> = {
  hero: 'hero',
  start: 'start',
  readiness: 'readiness',
  quality: 'quality',
  soil: 'soil',
  harvest: 'harvest',
};

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
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
    const spreadsheetId = process.env.COMPOST_SPREADSHEET_ID;
    if (!spreadsheetId) {
      return new Response(JSON.stringify({ error: 'Spreadsheet ID not configured' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(request.url);
    const systemFilter = url.searchParams.get('system');

    const auth = getAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });

    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: RANGE });
    const values = (res.data.values as string[][]) || [];

    const updates: Array<{ range: string; values: string[][] }> = [];
    let scanned = 0;
    let updatedEventDates = 0;
    let updatedTags = 0;
    const failures: string[] = [];

    // Skip header row (index 0). Sheet rows are 1-indexed so row i+1.
    for (let i = 1; i < values.length; i++) {
      const r = values[i];
      const system = r[0] || '';
      const slot = r[1] || '';
      const fileId = r[3] || '';
      const date = r[8] || '';
      const eventDate = r[11] || '';
      const tags = r[12] || '';

      if (!fileId) continue;
      if (systemFilter && system !== systemFilter) continue;

      scanned++;

      // Tags backfill — cheap, no Drive call
      if (!tags) {
        const inferred = SLOT_DEFAULT_TAGS[slot] || '';
        if (inferred) {
          updates.push({
            range: `'${MEDIA_TAB}'!M${i + 1}`,
            values: [[inferred]],
          });
          updatedTags++;
        }
      }

      // EventDate backfill — prefer existing Date column, else ask Drive
      if (!eventDate) {
        if (date) {
          // Normalise ISO → YYYY-MM-DD
          const dOnly = date.length >= 10 ? date.slice(0, 10) : date;
          updates.push({
            range: `'${MEDIA_TAB}'!L${i + 1}`,
            values: [[dOnly]],
          });
          updatedEventDates++;
        } else {
          try {
            const fileRes = await drive.files.get({
              fileId,
              fields: 'createdTime,imageMediaMetadata(time)',
              supportsAllDrives: true,
            });
            const exif = fileRes.data.imageMediaMetadata?.time; // "YYYY:MM:DD HH:MM:SS" if present
            const created = fileRes.data.createdTime;           // ISO
            let chosen = '';
            if (exif && /^\d{4}:\d{2}:\d{2}/.test(exif)) {
              chosen = exif.slice(0, 10).replace(/:/g, '-');
            } else if (created) {
              chosen = created.slice(0, 10);
            }
            if (chosen) {
              updates.push({
                range: `'${MEDIA_TAB}'!L${i + 1}`,
                values: [[chosen]],
              });
              updatedEventDates++;
            }
          } catch (err) {
            failures.push(`${fileId}: ${err instanceof Error ? err.message : 'unknown'}`);
          }
        }
      }
    }

    // Write all updates in one batch
    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: 'USER_ENTERED',
          data: updates,
        },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      scanned,
      updatedEventDates,
      updatedTags,
      failures,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    console.error('Error in media backfill:', error);
    return new Response(JSON.stringify({
      error: 'Backfill failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};

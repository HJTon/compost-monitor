import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

// Public event / tour feedback (the /feedback page).
// Answers go to the "Event Feedback" tab; contact details go to a separate
// "Feedback Contacts" tab keyed by the same ID, so the answers tab can be shared or
// reported on without exposing anyone's name or email.
//
// FEEDBACK_SPREADSHEET_ID (optional) sends both tabs to a separate spreadsheet;
// without it they land in the compost spreadsheet.

const ANSWERS_TAB = 'Event Feedback';
const CONTACTS_TAB = 'Feedback Contacts';

const ANSWER_HEADERS = [
  'ID', 'Submitted At', 'Event ID', 'Event', 'Attended Date', 'Date Source',
  'Sessions', 'Background', 'Most Valuable Learning', 'Most Interesting Aspects',
  'Understanding Improved', 'Overall Rating (1-5)', 'Explore Next', 'Next Priority',
  'Participation Interest', 'Improvements', 'Wants Contact',
];
const CONTACT_HEADERS = ['ID', 'Submitted At', 'Event', 'Name', 'Email', 'Organisation', 'Interests'];

function getGoogleSheetsClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const list = (v: unknown) => (Array.isArray(v) ? v.map(x => str(x, 300)).filter(Boolean).join('; ') : '');

export default async (req: Request, _context: Context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
  }

  try {
    const b = await req.json();

    // Honeypot: real people never see this field. Pretend success so bots move on.
    if (str(b.website)) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }

    const id = str(b.id, 64);
    const attendedDate = str(b.attendedDate, 10);
    if (!id || !/^\d{4}-\d{2}-\d{2}$/.test(attendedDate) || !str(b.mostValuable)) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    const sheets = getGoogleSheetsClient();
    const spreadsheetId = process.env.FEEDBACK_SPREADSHEET_ID || process.env.COMPOST_SPREADSHEET_ID!;

    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existing = new Set(meta.data.sheets?.map(s => s.properties?.title) ?? []);
    for (const [tab, headers] of [[ANSWERS_TAB, ANSWER_HEADERS], [CONTACTS_TAB, CONTACT_HEADERS]] as const) {
      if (existing.has(tab)) continue;
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }] },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tab}'!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [[...headers]] },
      });
    }

    // Retried submissions (flaky signal at a venue) must not double up: skip if the ID is already there.
    const ids = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${ANSWERS_TAB}'!A:A` });
    if ((ids.data.values ?? []).some(r => r[0] === id)) {
      return new Response(JSON.stringify({ success: true, duplicate: true }), { status: 200 });
    }

    const submittedAt = new Date().toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' });
    const eventTitle = str(b.eventTitle, 200);
    const wantsContact = b.wantsContact === true;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `'${ANSWERS_TAB}'!A:A`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          id, submittedAt, str(b.eventId, 64), eventTitle, attendedDate, str(b.dateSource, 20),
          list(b.sessions), list(b.background), str(b.mostValuable), list(b.aspects),
          str(b.understanding, 100), typeof b.rating === 'number' ? b.rating : '', list(b.exploreNext),
          str(b.priority), list(b.participation), str(b.improve), wantsContact ? 'Yes' : 'No',
        ]],
      },
    });

    if (wantsContact && (str(b.contactEmail) || str(b.contactName))) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${CONTACTS_TAB}'!A:A`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [[
            id, submittedAt, eventTitle, str(b.contactName, 200), str(b.contactEmail, 200),
            str(b.contactOrg, 200), list(b.participation),
          ]],
        },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Feedback write error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
};

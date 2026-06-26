import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

// Direct resumable upload to Drive for large files (videos) that blow past the
// ~4 MB Netlify function body limit. Instead of relaying bytes through the
// function, we mint a Drive *resumable upload session URI* server-side and hand
// it back to the browser, which PUTs the file straight to Drive — bypassing the
// function body cap entirely. A second `finalize` call sets public-read
// permissions once the upload has landed.
//
// Two actions, dispatched on the POST body's `action` field:
//   - 'init'     → { sessionUri }            (or { existing, fileId, webViewLink })
//   - 'finalize' → { fileId, webViewLink, thumbnailLink }

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

async function getOrCreateSubfolder(
  drive: ReturnType<typeof google.drive>,
  parentFolderId: string,
  folderName: string,
): Promise<string> {
  const safeName = folderName.replace(/[/\\?%*:|"<>]/g, '-').trim();
  const list = await drive.files.list({
    q: `name='${safeName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    fields: 'files(id)',
  });
  if (list.data.files && list.data.files.length > 0) return list.data.files[0].id!;

  const folder = await drive.files.create({
    requestBody: { name: safeName, mimeType: 'application/vnd.google-apps.folder', parents: [parentFolderId] },
    supportsAllDrives: true,
    fields: 'id',
  });
  return folder.data.id!;
}

export default async (request: Request, _context: Context) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    const folderId = process.env.COMPOST_DRIVE_FOLDER_ID;
    if (!folderId) return json({ error: 'Drive folder ID not configured' }, 500);

    const body = await request.json();
    const auth = getAuth();
    const drive = google.drive({ version: 'v3', auth });

    // ── finalize: set public-read perms + return shareable links ──────────
    if (body.action === 'finalize') {
      const { fileId } = body;
      if (!fileId) return json({ error: 'Missing fileId' }, 400);
      try {
        await drive.permissions.create({
          fileId,
          requestBody: { type: 'anyone', role: 'reader' },
          supportsAllDrives: true,
        });
      } catch (permErr) {
        console.warn('Could not set public permissions:', permErr instanceof Error ? permErr.message : permErr);
      }
      const meta = await drive.files.get({
        fileId,
        fields: 'id,webViewLink,thumbnailLink',
        supportsAllDrives: true,
      });
      return json({
        success: true,
        fileId,
        webViewLink: meta.data.webViewLink,
        thumbnailLink: meta.data.thumbnailLink,
      });
    }

    // ── init: resolve folder, dedupe, mint resumable session URI ──────────
    const { systemName, subfolder, filename, mimeType } = body;
    if (!filename) return json({ error: 'Missing filename' }, 400);

    let targetFolderId = folderId;
    if (systemName) {
      targetFolderId = await getOrCreateSubfolder(drive, folderId, systemName);
      if (subfolder) targetFolderId = await getOrCreateSubfolder(drive, targetFolderId, subfolder);
    }

    // Idempotency: a retried upload (same filename — client filenames embed a
    // unique timestamp) means the earlier attempt actually succeeded. Return
    // the existing file instead of creating a duplicate.
    const escapedName = filename.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const existing = await drive.files.list({
      q: `name='${escapedName}' and '${targetFolderId}' in parents and trashed=false`,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: 'files(id,webViewLink)',
    });
    if (existing.data.files && existing.data.files.length > 0) {
      const dupe = existing.data.files[0];
      return json({ success: true, existing: true, fileId: dupe.id, webViewLink: dupe.webViewLink });
    }

    // Access token for the raw resumable-upload request.
    const client = await auth.getClient();
    const tokenResp = await client.getAccessToken();
    const token = typeof tokenResp === 'string' ? tokenResp : tokenResp?.token;
    if (!token) return json({ error: 'Could not obtain access token' }, 500);

    // Echo the browser's origin onto the initiation request so Drive enables
    // CORS for that origin on the returned session URI — the browser then PUTs
    // straight to Drive cross-origin.
    const appOrigin = request.headers.get('origin') || new URL(request.url).origin;

    const initRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType || 'application/octet-stream',
          Origin: appOrigin,
        },
        body: JSON.stringify({ name: filename, parents: [targetFolderId] }),
      },
    );

    if (!initRes.ok) {
      const detail = await initRes.text();
      console.error('Resumable session init failed:', initRes.status, detail);
      return json({ error: 'Failed to start upload session', status: initRes.status }, 502);
    }

    const sessionUri = initRes.headers.get('location');
    if (!sessionUri) return json({ error: 'No session URI returned by Drive' }, 502);

    return json({ success: true, sessionUri });
  } catch (error) {
    console.error('Error in media upload session:', error);
    return json({
      error: 'Upload session error',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
};

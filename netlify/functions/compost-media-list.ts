import type { Context } from '@netlify/functions';
import { google } from 'googleapis';

function getDriveClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
}

async function findSubfolderId(
  drive: ReturnType<typeof getDriveClient>,
  parentFolderId: string,
  folderName: string,
): Promise<string | null> {
  const safeName = folderName.replace(/[/\\?%*:|"<>]/g, '-').trim();
  const list = await drive.files.list({
    q: `name='${safeName.replace(/'/g, "\\'")}' and mimeType='application/vnd.google-apps.folder' and '${parentFolderId}' in parents and trashed=false`,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    fields: 'files(id)',
  });
  return list.data.files && list.data.files.length > 0 ? list.data.files[0].id! : null;
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
    const parentFolderId = process.env.COMPOST_DRIVE_FOLDER_ID;
    if (!parentFolderId) {
      return new Response(JSON.stringify({ error: 'Drive folder ID not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const url = new URL(request.url);
    const systemName = url.searchParams.get('systemName');
    if (!systemName) {
      return new Response(JSON.stringify({ error: 'Missing ?systemName= parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const drive = getDriveClient();
    const folderId = await findSubfolderId(drive, parentFolderId, systemName);

    if (!folderId) {
      return new Response(JSON.stringify({ success: true, files: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const res = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false and (mimeType contains 'image/' or mimeType contains 'video/')`,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: 'files(id,name,mimeType,thumbnailLink,webContentLink,webViewLink,createdTime,imageMediaMetadata(width,height))',
      orderBy: 'createdTime desc',
      pageSize: 200,
    });

    const files = (res.data.files || []).map(f => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType,
      thumbnailLink: f.thumbnailLink,
      webContentLink: f.webContentLink,
      webViewLink: f.webViewLink,
      createdTime: f.createdTime,
      width: f.imageMediaMetadata?.width,
      height: f.imageMediaMetadata?.height,
    }));

    return new Response(JSON.stringify({ success: true, files, folderId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (error) {
    console.error('Error listing Drive media:', error);
    return new Response(JSON.stringify({
      error: 'Failed to list Drive media',
      details: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
};

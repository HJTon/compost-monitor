import type { Context } from '@netlify/functions';
import { google } from 'googleapis';
import { Readable } from 'stream';

function getDriveClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  return google.drive({ version: 'v3', auth });
}

interface UploadRequest {
  mediaData: string;  // base64 encoded (with or without data URL prefix)
  mimeType: string;
  filename: string;
}

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
    const folderId = process.env.COMPOST_DRIVE_FOLDER_ID;
    if (!folderId) {
      return new Response(JSON.stringify({ error: 'Drive folder ID not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const body: UploadRequest = await request.json();
    const { mediaData, mimeType, filename } = body;

    if (!mediaData || !filename) {
      return new Response(JSON.stringify({ error: 'Missing required fields: mediaData, filename' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const base64Data = mediaData.includes(',') ? mediaData.split(',')[1] : mediaData;
    const buffer = Buffer.from(base64Data, 'base64');

    // Reject files over 4 MB (Netlify function body limit is 6 MB; leave headroom)
    if (buffer.byteLength > 4 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: 'File too large — maximum 4 MB per upload' }), {
        status: 413,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const drive = getDriveClient();

    // Build a readable stream from the buffer for the googleapis upload
    const uploadStream = new Readable();
    uploadStream.push(buffer);
    uploadStream.push(null);

    const file = await drive.files.create({
      requestBody: {
        name: filename,
        parents: [folderId],
      },
      media: {
        mimeType,
        body: uploadStream,
      },
      fields: 'id,webViewLink',
    });

    const fileId = file.data.id!;

    // Make the file viewable by anyone with the link
    // (staff don't need a Google account; URLs land in the Sheet as clickable links)
    await drive.permissions.create({
      fileId,
      requestBody: { type: 'anyone', role: 'reader' },
    });

    return new Response(JSON.stringify({
      success: true,
      fileId,
      webViewLink: file.data.webViewLink,
      filename,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });

  } catch (error) {
    console.error('Error uploading to Drive:', error);
    return new Response(JSON.stringify({
      error: 'Failed to upload to Drive',
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

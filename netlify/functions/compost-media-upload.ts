import type { Context } from '@netlify/functions';
import { google } from 'googleapis';
import { Readable } from 'stream';

function getGoogleDriveClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });
  return google.drive({ version: 'v3', auth });
}

interface UploadRequest {
  mediaData: string;     // Base64 encoded
  mimeType: string;      // e.g., 'image/jpeg', 'video/mp4'
  filename: string;      // e.g., '2026-02-15_Pivot-1_photo_abc123.jpg'
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
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
      return new Response(JSON.stringify({ error: 'Drive folder ID not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body: UploadRequest = await request.json();
    const { mediaData, mimeType, filename } = body;

    if (!mediaData || !filename) {
      return new Response(JSON.stringify({ error: 'Missing required fields: mediaData, filename' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const drive = getGoogleDriveClient();

    // Strip data URL prefix if present
    const base64Data = mediaData.includes(',') ? mediaData.split(',')[1] : mediaData;
    const buffer = Buffer.from(base64Data, 'base64');

    const fileMetadata = {
      name: filename,
      parents: [folderId],
    };

    const media = {
      mimeType: mimeType || 'image/jpeg',
      body: Readable.from(buffer),
    };

    // For files > 5MB, googleapis handles resumable uploads automatically
    const file = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id, webViewLink, webContentLink',
    });

    // Make viewable by anyone with the link
    await drive.permissions.create({
      fileId: file.data.id!,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    const thumbnailLink = `https://drive.google.com/thumbnail?id=${file.data.id}&sz=w400`;

    return new Response(JSON.stringify({
      success: true,
      fileId: file.data.id,
      webViewLink: file.data.webViewLink,
      thumbnailLink,
      filename,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error uploading media:', error);
    return new Response(JSON.stringify({
      error: 'Failed to upload media',
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

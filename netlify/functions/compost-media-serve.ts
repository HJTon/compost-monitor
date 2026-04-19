import type { Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';

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
    const url = new URL(request.url);
    const key = url.searchParams.get('key');

    if (!key) {
      return new Response(JSON.stringify({ error: 'Missing ?key= parameter' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const store = getStore({ name: 'compost-media', consistency: 'strong' });
    const { data, metadata } = await store.getWithMetadata(key, { type: 'arrayBuffer' });

    if (!data) {
      return new Response('Not found', { status: 404 });
    }

    const mimeType = metadata?.mimeType || 'application/octet-stream';

    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('Error serving media:', error);
    return new Response(JSON.stringify({
      error: 'Failed to serve media',
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

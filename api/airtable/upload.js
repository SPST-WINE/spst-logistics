// /api/airtable/upload.js
// POST /api/airtable/upload?filename=...&contentType=...
// Body: raw file bytes → risponde { url, attachments:[{url}] } per Airtable

import { put } from '@vercel/blob';

export const config = { runtime: 'edge' }; // Edge = streaming, no body limit del serverless Node

// Domini abilitati (aggiungi staging se serve)
const ALLOW_ORIGINS = [
  'https://www.spst.it',
  'https://spst-logistics.vercel.app',
  'http://localhost:3000',
];

function corsHeaders(origin) {
  const allow = ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

export default async function handler(req) {
  const origin = req.headers.get('origin') || '';
  const baseHeaders = corsHeaders(origin);

  // Preflight CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: baseHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { searchParams } = new URL(req.url);
  const filename = searchParams.get('filename') || `upload-${Date.now()}.bin`;
  const contentType = searchParams.get('contentType') || 'application/octet-stream';

  // In Edge, req.body è uno stream → niente buffer in RAM ⇒ niente 413
  const bodyStream = req.body;
  if (!bodyStream) {
    return new Response(JSON.stringify({ error: 'Empty body' }), {
      status: 400,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const res = await put(filename, bodyStream, {
      access: 'public',
      contentType,
      addRandomSuffix: false, // così il nome rimane leggibile
    });

    return new Response(
      JSON.stringify({
        url: res.url,
        // comodo per patch Airtable: i campi attachment accettano array di {url}
        attachments: [{ url: res.url }],
      }),
      { status: 200, headers: { ...baseHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
    });
  }
}

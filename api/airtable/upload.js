// /api/airtable/upload.js
// POST /api/airtable/upload?filename=...&contentType=...
// Body: raw file bytes → risponde { url, attachments:[{url}] } per Airtable

import { put } from '@vercel/blob';

// ✅ Node runtime (non Edge), niente limiti Edge e compat totale
export const config = {
  api: {
    bodyParser: false,     // riceviamo binario
    sizeLimit: '150mb',    // alza il limite per PDF grossi
  },
};

// Domini abilitati (aggiungi staging se serve)
const ALLOW_ORIGINS = new Set([
  'https://www.spst.it',
  'https://spst-logistics.vercel.app',
  'http://localhost:3000',
]);

function setCors(res, origin) {
  const allow = ALLOW_ORIGINS.has(origin) ? origin : 'https://www.spst.it';
  res.setHeader('Access-Control-Allow-Origin', allow);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Access-Control-Expose-Headers', 'x-debug');
}

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  setCors(res, origin);

  // Preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('x-debug', 'preflight-ok');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('x-debug', 'method-not-allowed');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const url = new URL(req.url, 'http://localhost'); // base fittizia per parse
    const filename = (url.searchParams.get('filename') || `upload-${Date.now()}.bin`).toString();
    const contentType = (url.searchParams.get('contentType') || 'application/octet-stream').toString();

    const buffer = await readBuffer(req);
    if (!buffer?.length) {
      res.setHeader('x-debug', 'empty-body');
      return res.status(400).json({ error: 'Empty body' });
    }

    const blob = await put(filename, buffer, {
      access: 'public',
      contentType,
      addRandomSuffix: false,
    });

    res.setHeader('x-debug', 'upload-ok');
    return res.status(200).json({
      url: blob?.url,
      attachments: [{ url: blob?.url }], // 🔁 pronto per Airtable attachments
    });
  } catch (e) {
    console.error('[upload] error', e);
    res.setHeader('x-debug', 'upload-exception');
    return res.status(502).json({ error: 'Upload failed', details: String(e?.message || e) });
  }
}

/* ───────── helpers ───────── */

async function readBuffer(req) {
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

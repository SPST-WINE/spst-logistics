// api/airtable/upload.js

// ✅ Forza runtime Node (NON Edge) e alza il limite a 50 MB
export const config = {
  runtime: 'nodejs',
  api: { bodyParser: false, sizeLimit: '50mb' },
};

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || 'https://www.spst.it';

export default async function handler(req, res) {
  setCORS(res);

  // Preflight CORS
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const filename = String(req.query.filename || 'upload.bin');
    const contentType = String(req.query.contentType || 'application/octet-stream');

    // Import dinamico per evitare errori in build
    const { put } = await import('@vercel/blob');

    const buffer = await readBuffer(req);
    if (!buffer?.length) {
      res.setHeader('x-debug', 'empty-body');
      res.status(400).json({ error: 'Empty body' });
      return;
    }

    // ✅ Se hai collegato lo Store via integrazione, il token è automatico.
    // ✅ In alternativa puoi passare il token manualmente (vedi passo 2).
    const blob = await put(filename, buffer, {
      access: 'public',
      contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN, // opzionale: se presente lo usa
    });

    res.setHeader('Access-Control-Expose-Headers', 'x-debug');
    res.setHeader('x-debug', 'upload-ok');
    res.status(200).json({
      url: blob?.url,
      attachments: [{ url: blob?.url }], // comodo per Airtable attachments
    });
  } catch (e) {
    console.error('[upload] error', e);
    res.setHeader('x-debug', 'upload-exception');
    res.status(502).json({ error: 'Upload failed', details: String(e?.message || e) });
  }
}

/* ---------- helpers ---------- */

function setCORS(res) {
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with');
  res.setHeader('Access-Control-Max-Age', '86400');
}

async function readBuffer(req) {
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

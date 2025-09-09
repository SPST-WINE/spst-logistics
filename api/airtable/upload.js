// api/airtable/upload.js
// POST /api/airtable/upload?filename=...&contentType=...
// Body: raw file bytes -> ritorna { url } pubblico (Vercel Blob)

export const config = {
  runtime: 'nodejs18.x',      // forza Serverless Node (no Edge)
  api: {
    bodyParser: false,        // riceviamo binario
    sizeLimit: '50mb',        // alza limite per PDF grossi
  },
};

const ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || 'https://www.spst.it';

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    setCors(res);
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    setCors(res);
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const filename = (req.query.filename || 'upload.bin').toString();
    const contentType = (req.query.contentType || 'application/octet-stream').toString();

    // import dinamico per evitare errori in build se manca la dep
    let put;
    try {
      ({ put } = await import('@vercel/blob'));
    } catch (e) {
      setCors(res);
      return res.status(500).json({
        error: 'Missing @vercel/blob',
        details: 'Installa @vercel/blob e configura BLOB_READ_WRITE_TOKEN',
      });
    }

    const buffer = await readBuffer(req);
    if (!buffer?.length) {
      setCors(res);
      return res.status(400).json({ error: 'Empty body' });
    }

    // opzionale: pass token esplicito (se usi token RW)
    const options = { access: 'public', contentType };
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      options.token = process.env.BLOB_READ_WRITE_TOKEN;
    }

    const blob = await put(filename, buffer, options);

    setCors(res);
    res.status(200).json({ url: blob?.url, attachments: [{ url: blob?.url }] });
  } catch (e) {
    console.error('[upload] error', e);
    setCors(res);
    res.status(502).json({ error: 'Upload failed', details: String(e?.message || e) });
  }
}

/* helpers */
function setCors(res) {
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Access-Control-Expose-Headers', 'x-debug');
}

async function readBuffer(req) {
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

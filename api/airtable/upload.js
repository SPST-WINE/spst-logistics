// POST /api/airtable/upload?filename=...&contentType=...
// Body: raw file bytes. Ritorna { url } pubblico per Airtable attachments.

export default async function handler(req, res){
  if (handleCORS(req, res)) return;          // CORS + OPTIONS 204

  if (req.method !== 'POST') {
    res.setHeader('x-debug', 'method-not-allowed');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const filename = (req.query.filename || 'upload.bin').toString();
    const contentType = (req.query.contentType || 'application/octet-stream').toString();

    // Dynamic import: evita crash a import-time se manca la dependency/token
    let put;
    try {
      ({ put } = await import('@vercel/blob'));
    } catch {
      res.setHeader('x-debug', 'missing-vercel-blob');
      return res.status(500).json({
        error: 'Missing @vercel/blob',
        details: 'Installa @vercel/blob e collega lo store o imposta BLOB_READ_WRITE_TOKEN'
      });
    }

    const buffer = await readBuffer(req);
    if (!buffer?.length) {
      res.setHeader('x-debug', 'empty-body');
      return res.status(400).json({ error: 'Empty body' });
    }

    const blob = await put(filename, buffer, { access: 'public', contentType });
    res.setHeader('x-debug', 'upload-ok');
    return res.status(200).json({ url: blob?.url });
  } catch (e) {
    console.error('[upload] error', e);
    res.setHeader('x-debug', 'upload-exception');
    return res.status(502).json({ error: 'Upload failed', details: String(e?.message || e) });
  }
}

/* ───────── helpers ───────── */

function handleCORS(req, res){
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-requested-with');
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Access-Control-Expose-Headers', 'x-debug');

  if (req.method === 'OPTIONS') {
    res.setHeader('x-debug', 'preflight-ok');
    res.status(204).end();
    return true;
  }
  return false;
}

async function readBuffer(req){
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

export const config = {
  api: {
    bodyParser: false,           // riceviamo binario
    sizeLimit: '50mb',           // ↑ alza il limite (scegli tu)
  }
};

const ALLOW_ORIGIN = 'https://www.spst.it'; // o '*', ma meglio il tuo dominio

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    // ... qui leggi lo stream dal req e fai l’upload allo storage ...
    // ottenuta la url finale:
    const publicUrl = /* ... */;

    res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
    res.status(200).json({ url: publicUrl });
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
    res.status(500).json({ error: String(e?.message || e) });
  }
}

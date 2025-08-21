// /api/airtable/upload.js
// POST /api/airtable/upload?filename=...&contentType=...
// Body: raw file bytes. Ritorna { url } pubblico da usare come attachment in Airtable.

import { put } from '@vercel/blob';

export default async function handler(req, res){
  // CORS sempre
  if (handleCORS(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try{
    const filename = (req.query.filename || 'upload.bin').toString();
    const contentType = (req.query.contentType || 'application/octet-stream').toString();

    const buffer = await readBuffer(req);
    if (!buffer || !buffer.length){
      return res.status(400).json({ error: 'Empty body' });
    }

    // Upload su Vercel Blob (store connesso al progetto o via BLOB_READ_WRITE_TOKEN)
    const blob = await put(filename, buffer, { access: 'public', contentType });

    return res.status(200).json({ url: blob?.url });
  }catch(e){
    console.error('[upload] error', e);
    return res.status(502).json({ error: 'Upload failed', details: String(e?.message || e) });
  }
}

/* ───────── helpers ───────── */

function handleCORS(req, res){
  const origin = req.headers.origin || '';
  const allow = (process.env.ORIGIN_ALLOWLIST || '*').trim();

  // Header base
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  // tieni largo per evitare future header custom
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Politica: se allowlist è vuota o '*', consenti tutti; altrimenti consenti gli origin che matchano
  if (allow === '*' || !allow) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else {
    const list = allow.split(',').map(s => s.trim()).filter(Boolean);
    const ok = list.some(p => safeWildcardMatch(origin, p));
    // se matcha, riflettiamo l'origin; altrimenti di default mettiamo il primo consentito
    res.setHeader('Access-Control-Allow-Origin', ok && origin ? origin : list[0] || '*');
  }

  // Preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

function safeWildcardMatch(input, pattern){
  if (!pattern) return false;
  if (pattern === '*') return true;
  const rx = '^' + pattern.split('*').map(escapeRegex).join('.*') + '$';
  return new RegExp(rx).test(input || '');
}
function escapeRegex(str){ return str.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'); }

async function readBuffer(req){
  const chunks = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}
